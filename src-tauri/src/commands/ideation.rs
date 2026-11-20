//! 构思向导草稿命令。
//!
//! 与其它命令一致：数据库操作是同步阻塞的，统一走 `blocking` 丢到阻塞线程池，
//! 避免占住 WebView 的主线程。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{IdeationDraft, IdeationDraftInput};
use crate::services::ideation_draft;

#[tauri::command]
pub async fn load_ideation_draft(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<IdeationDraft>, AppError> {
    blocking(app, move |state| {
        ideation_draft::load(state, &project_id)
    })
    .await
}

#[tauri::command]
pub async fn save_ideation_draft(
    app: tauri::AppHandle,
    input: IdeationDraftInput,
) -> Result<IdeationDraft, AppError> {
    blocking(app, move |state| ideation_draft::save(state, &input)).await
}
