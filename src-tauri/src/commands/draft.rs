//! 写作台命令层：薄适配，只把参数透传给 service。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{ChapterContent, DraftVersion, DraftVersionBrief, SaveContentInput};
use crate::services::draft;

#[tauri::command]
pub async fn get_chapter_content(
    app: tauri::AppHandle,
    chapter_id: String,
) -> Result<ChapterContent, AppError> {
    blocking(app, move |state| draft::get_content(state, &chapter_id)).await
}

#[tauri::command]
pub async fn save_chapter_content(
    app: tauri::AppHandle,
    input: SaveContentInput,
) -> Result<ChapterContent, AppError> {
    blocking(app, move |state| draft::save_content(state, input)).await
}

#[tauri::command]
pub async fn list_draft_versions(
    app: tauri::AppHandle,
    chapter_id: String,
) -> Result<Vec<DraftVersionBrief>, AppError> {
    blocking(app, move |state| draft::list_versions(state, &chapter_id)).await
}

#[tauri::command]
pub async fn get_draft_version(
    app: tauri::AppHandle,
    id: String,
) -> Result<DraftVersion, AppError> {
    blocking(app, move |state| draft::get_version(state, &id)).await
}

#[tauri::command]
pub async fn restore_draft_version(
    app: tauri::AppHandle,
    id: String,
) -> Result<ChapterContent, AppError> {
    blocking(app, move |state| draft::restore_version(state, &id)).await
}
