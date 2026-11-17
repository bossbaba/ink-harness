//! RAG 检索命令：索引状态、重建索引、按问题取相关片段。
//!
//! 三层只做适配：命令层不碰 SQL，也不决定注入多少片段（那是前端提示词的事）。

use tauri::State;

use crate::infrastructure::db::DbState;
use crate::models::{RagHit, RagStatus};
use crate::services::rag;

#[tauri::command]
pub fn rag_status(state: State<'_, DbState>, project_id: String) -> Result<RagStatus, String> {
    rag::status(&state, &project_id)
}

/// 全量重建索引会逐条调用 embedding，耗时随作品规模增长，前端记得给 loading。
#[tauri::command]
pub async fn rag_reindex(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<RagStatus, String> {
    rag::reindex(&state, &project_id).await
}

/// 检索相关片段。未建索引时返回空数组，调用方按「没有参考资料」继续提问即可。
#[tauri::command]
pub async fn rag_search(
    state: State<'_, DbState>,
    project_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<RagHit>, String> {
    rag::search(&state, &project_id, &query, limit.unwrap_or(5)).await
}
