//! RAG 检索命令：索引状态、重建索引、按问题取相关片段。
//!
//! 三层只做适配：命令层不碰 SQL，也不决定注入多少片段（那是前端提示词的事）。
//!
//! `rag_reindex` / `rag_search` 保持 async 而非走 [`crate::commands::blocking`]：
//! 它们的主要耗时在网络（embedding 调用），DB 操作是穿插的小段读写；
//! async 命令本身已经不在主线程执行，再包一层阻塞线程池没有收益。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{RagHit, RagStatus};
use crate::services::rag;

#[tauri::command]
pub async fn rag_status(app: tauri::AppHandle, project_id: String) -> Result<RagStatus, AppError> {
    blocking(app, move |state| rag::status(state, &project_id)).await
}

/// 全量重建索引会逐条调用 embedding，耗时随作品规模增长，前端记得给 loading。
#[tauri::command]
pub async fn rag_reindex(
    state: tauri::State<'_, crate::infrastructure::db::DbState>,
    project_id: String,
) -> Result<RagStatus, AppError> {
    rag::reindex(&state, &project_id).await
}

/// 检索相关片段。未建索引时返回空数组，调用方按「没有参考资料」继续提问即可。
#[tauri::command]
pub async fn rag_search(
    state: tauri::State<'_, crate::infrastructure::db::DbState>,
    project_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<RagHit>, AppError> {
    // 默认取几条由 service 决定（产品口径），命令层只做透传，避免前后端口径漂移。
    rag::search(&state, &project_id, &query, limit).await
}
