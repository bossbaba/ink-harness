//! 向量表（sqlite-vec 的 vec0 虚拟表）的建表、维度记录与 KNN 查询。
//!
//! vec0 表的维度在建表时就固定了，换模型时维度往往一起变。以前的做法是直接 drop
//! 整张 `vec_rag`，结果其它作品（还停留在旧维度）的向量也一起消失。现在按维度分表
//! `vec_rag_{dim}`：新维度建新表，旧表留给仍用旧维度的作品，切回旧模型不必重建。

use rusqlite::{Connection, params};

use super::super::setting;
use crate::error::AppError;
use crate::infrastructure::db::DbState;

/// 全局维度记录：升级前的老库只有它，作品级键缺失时回退到这里。
pub(super) const DIM_KEY: &str = "rag_dim";
const LEGACY_TABLE: &str = "vec_rag";
/// KNN 先多取一些再按作品过滤：同库多作品时，别人的片段会占掉候选位。
const KNN_OVERSCAN: i64 = 8;

/// 作品级向量维度键：同一时间不同作品可能落在不同维度的表上。
pub(super) fn indexed_dim_key(project_id: &str) -> String {
    format!("rag_dim:{project_id}")
}

/// 维度表名。dim 由解析后的整数生成，不接受外部字符串，拼接不构成注入面。
pub(super) fn table_name(dim: i64) -> String {
    format!("vec_rag_{dim}")
}

/// 库里所有向量表（含升级前的 `vec_rag`）。删片段时必须按 rowid 清理每一张，
/// 否则换过维度的作品再删章节时，其它表里的旧向量会变成永远回收不掉的幽灵数据。
///
/// sqlite-vec 会为虚拟表建 `vec_rag_3_data` / `vec_rag_3_index` 之类的影子表，
/// 这里只保留纯数字后缀的实体表名，否则会把影子表当成向量表去删。
pub(super) fn all_table_names(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn
        .prepare("select name from sqlite_master where type = 'table' and name like 'vec_rag%'")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::from)?;
    let names = rows.collect::<Result<Vec<String>, _>>().map_err(AppError::from)?;
    Ok(names
        .into_iter()
        .filter(|name| {
            if name == LEGACY_TABLE {
                return true;
            }
            name.strip_prefix("vec_rag_")
                .is_some_and(|suffix| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        })
        .collect())
}

/// 指定维度的表是否已建。传入哪个连接就查哪个库文件。
pub(super) fn vec_table_in(conn: &Connection, dim: i64) -> Result<bool, AppError> {
    let count: i64 = conn
        .query_row(
            "select count(*) from sqlite_master where name = ?1",
            params![table_name(dim)],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    Ok(count > 0)
}

pub(super) fn vec_table_exists(state: &DbState, dim: i64) -> Result<bool, AppError> {
    let conn = state.vec();
    vec_table_in(&conn, dim)
}

/// 全局维度记录，仅用于老库兼容与状态展示；判定某个作品要用 `indexed_dim_key`。
pub(super) fn current_dim(state: &DbState) -> Result<Option<i64>, AppError> {
    Ok(setting::get(state, DIM_KEY)?.and_then(|value| value.trim().parse::<i64>().ok()))
}

/// 确保维度对应的表存在。返回 ()：新建新表不再意味着旧表被删，
/// 其它作品的向量会原样留在自己的维度表里。
///
/// 升级兼容：老库只有一张 `vec_rag`、维度记在全局 `DIM_KEY`。第一次用到同维度时
/// 把数据搬进 `vec_rag_{dim}` 再删旧表；搬运失败就保留两张表——删除片段时会按
/// rowid 同时清理，最坏情况是该作品需要手动重建一次索引。
pub(super) fn ensure_vec_table(state: &DbState, dim: i64) -> Result<(), AppError> {
    let conn = state.vec();
    if vec_table_in(&conn, dim)? {
        return Ok(());
    }
    let name = table_name(dim);
    conn.execute_batch(&format!(
        "create virtual table {name} using vec0(embedding float[{dim}]);"
    ))
    .map_err(AppError::from)?;

    if current_dim(state)? == Some(dim) {
        let legacy: i64 = conn
            .query_row(
                "select count(*) from sqlite_master where type = 'table' and name = ?1",
                params![LEGACY_TABLE],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if legacy > 0 {
            let _ = conn.execute_batch(&format!(
                "insert into {name} (rowid, embedding) select rowid, embedding from {LEGACY_TABLE};
                 drop table {LEGACY_TABLE};"
            ));
        }
    }
    drop(conn);

    setting::set(state, DIM_KEY, &dim.to_string())?;
    Ok(())
}

/// 按距离取最近的若干向量，返回 (rowid, distance)。
///
/// 表名由查询向量自身的维度决定：检索模型换了维度就会查另一张表，
/// 不会拿低维问题去撞高维索引（那样 sqlite-vec 会直接报错）。
pub(super) fn knn(
    state: &DbState,
    vector: &[f32],
    limit: usize,
) -> Result<Vec<(i64, f64)>, AppError> {
    let conn = state.vec();
    let dim = vector.len() as i64;
    if !vec_table_in(&conn, dim)? {
        return Ok(Vec::new());
    }
    let name = table_name(dim);
    let literal = vector_literal(vector);
    let sql = format!(
        "select rowid, distance from {name}
         where embedding match ?1 order by distance limit ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![literal, limit as i64 * KNN_OVERSCAN], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(AppError::from)?;
    // 逐行错误必须上抛：静默跳过损坏行会让检索结果不完整，且故障完全不可见。
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// sqlite-vec 只认 `[1,0.5,-2]` 这种文本字面量，数字用 f32 的最短表示。
pub(super) fn vector_literal(vector: &[f32]) -> String {
    let parts: Vec<String> = vector.iter().map(|value| value.to_string()).collect();
    format!("[{}]", parts.join(","))
}
