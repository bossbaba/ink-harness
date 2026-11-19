//! 向量表（sqlite-vec 的 vec0 虚拟表）的建表、维度记录与 KNN 查询。
//!
//! 向量维度由 embedding 模型决定，换模型时维度往往一起变，而 vec0 表的维度在
//! 建表时就固定了，所以只能在维度不同时整表重建（旧向量全部作废）。

use rusqlite::params;

use super::super::setting;
use crate::error::AppError;
use crate::infrastructure::db::DbState;

/// 向量表维度记录在 app_meta；与当前模型输出维度不同说明换过模型，必须重建。
pub(super) const DIM_KEY: &str = "rag_dim";
/// KNN 先多取一些再按作品过滤：同库多作品时，别人的片段会占掉候选位。
const KNN_OVERSCAN: i64 = 8;

/// 向量表是否存在（没做过 embedding 时不存在）。传入哪个连接就查哪个库文件。
pub(super) fn vec_table_in(conn: &rusqlite::Connection) -> Result<bool, AppError> {
    let count: i64 = conn
        .query_row(
            "select count(*) from sqlite_master where name = 'vec_rag'",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    Ok(count > 0)
}

pub(super) fn vec_table_exists(state: &DbState) -> Result<bool, AppError> {
    let conn = state.vec();
    vec_table_in(&conn)
}

pub(super) fn current_dim(state: &DbState) -> Result<Option<i64>, AppError> {
    Ok(setting::get(state, DIM_KEY)?.and_then(|value| value.trim().parse::<i64>().ok()))
}

/// 确保向量表存在且维度正确；返回「是否重建过」（重建意味着旧向量全丢）。
pub(super) fn ensure_vec_table(state: &DbState, dim: i64) -> Result<bool, AppError> {
    if vec_table_exists(state)? && current_dim(state)? == Some(dim) {
        return Ok(false);
    }
    {
        let conn = state.vec();
        conn.execute_batch("drop table if exists vec_rag;")
            .map_err(AppError::from)?;
        conn.execute_batch(&format!(
            "create virtual table vec_rag using vec0(embedding float[{dim}]);"
        ))
        .map_err(AppError::from)?;
    }
    setting::set(state, DIM_KEY, &dim.to_string())?;
    Ok(true)
}

/// 按距离取最近的若干向量，返回 (rowid, distance)。
///
/// 这里不按作品过滤（vec_rag 里没有作品列），多取 `KNN_OVERSCAN` 倍候选交给
/// `load_hits` 过滤，避免别的作品占满候选位。
pub(super) fn knn(
    state: &DbState,
    vector: &[f32],
    limit: usize,
) -> Result<Vec<(i64, f64)>, AppError> {
    let literal = vector_literal(vector);
    let conn = state.vec();
    let mut stmt = conn
        .prepare(
            "select rowid, distance from vec_rag
             where embedding match ?1 order by distance limit ?2",
        )
        .map_err(AppError::from)?;
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
