//! 片段与向量的联动清理。
//!
//! `rag_chunk` 的 `source_id` 是裸 TEXT，没有外键约束：删章节、删设定条目、删作品
//! 都不会自动清理索引。必须显式删，否则被删掉的正文仍会作为「参考资料」被检索出来
//! （既是错误结果也是隐私问题）。清理复用业务删除自己的事务，先提交删除再清索引
//! 会让这期间的数据继续暴露。

use rusqlite::{Connection, params};

use crate::error::AppError;
use crate::infrastructure::db::{DbState, delete_vec_rows};

/// 清空片段。`all` 为真时连通所有作品一起清（仅在老库整体重建时使用）。
pub(super) fn clear_chunks(state: &DbState, project_id: &str, all: bool) -> Result<(), AppError> {
    let mut conn = state.biz();
    let tx = conn.transaction().map_err(AppError::from)?;
    let ids = collect_ids(&tx, all, project_id)?;
    delete_rows(&tx, &ids)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

/// 在调用方已经开启的事务里清掉某个来源的片段与向量。
///
/// 不再提供「自己开事务」的版本：清理逻辑只有这一条路径，
/// 避免以后有人绕过事务调用，又把原子性丢掉。
pub(crate) fn purge_source_in(
    conn: &Connection,
    source_id: &str,
) -> Result<(), AppError> {
    delete_by_cond(conn, "source_id = ?1", params![source_id])
}

/// 同上，按作品清（删作品时与 `delete from project` 放同一事务）。
///
/// 删作品时 `rag_chunk` 靠外键级联走了，但向量表没有外键，必须在 project
/// 被删之前先清向量，否则 rowid 再也对不上，残留向量永远无法回收。
pub(crate) fn purge_project_in(
    conn: &Connection,
    project_id: &str,
) -> Result<(), AppError> {
    delete_by_cond(conn, "project_id = ?1", params![project_id])
}

/// 按条件删片段：先查出 rowid，再删向量、删片段。
///
/// 事务由调用方负责（业务删除直接复用它的写事务）。
/// `cond` 只允许传本文件内的字面量（不接收外部输入），因此这里的 `format!` 不构成注入面。
fn delete_by_cond<P: rusqlite::Params>(
    conn: &Connection,
    cond: &str,
    params: P,
) -> Result<(), AppError> {
    let ids = {
        let sql = format!("select id from rag_chunk where {cond}");
        let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
        let rows = stmt
            .query_map(params, |row| row.get::<_, i64>(0))
            .map_err(AppError::from)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?
    };
    delete_rows(conn, &ids)?;
    Ok(())
}

pub(super) fn collect_ids(
    conn: &Connection,
    all: bool,
    project_id: &str,
) -> Result<Vec<i64>, AppError> {
    if all {
        let mut stmt = conn
            .prepare("select id from rag_chunk")
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(AppError::from)?;
        return rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from);
    }
    let mut stmt = conn
        .prepare("select id from rag_chunk where project_id = ?1")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, i64>(0))
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 按 rowid 批量删向量与片段。
///
/// 换维度后同一 rowid 可能同时存在于旧表和新表（老库迁移时搬过数据），
/// 所以要遍历所有 `vec_rag*` 表删除；只删当前维度表会留下幽灵向量。
/// 向量表可能从未建过（没做过 embedding），此时跳过。
pub(super) fn delete_rows(conn: &Connection, ids: &[i64]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    delete_vec_rows(conn, ids)?;
    let mut stmt = conn
        .prepare("delete from rag_chunk where id = ?1")
        .map_err(AppError::from)?;
    for id in ids {
        stmt.execute(params![id]).map_err(AppError::from)?;
    }
    Ok(())
}
