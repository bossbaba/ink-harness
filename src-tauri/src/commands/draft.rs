//! 写作台命令层：薄适配，只把参数透传给 service。
//!
//! 所有按 id 定位资源的命令都要求调用方显式声明作品，并在进入 service 前
//! 核对该资源确实属于这个作品，避免跨作品串数据。

use super::ownership;
use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{ChapterContent, DraftVersion, DraftVersionBrief, SaveContentInput};
use crate::services::draft;

#[tauri::command]
pub async fn get_chapter_content(
    app: tauri::AppHandle,
    chapter_id: String,
    project_id: String,
) -> Result<ChapterContent, AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &chapter_id, &project_id)?;
        draft::get_content(state, &chapter_id)
    })
    .await
}

#[tauri::command]
pub async fn save_chapter_content(
    app: tauri::AppHandle,
    input: SaveContentInput,
    project_id: String,
) -> Result<ChapterContent, AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &input.chapter_id, &project_id)?;
        draft::save_content(state, input)
    })
    .await
}

#[tauri::command]
pub async fn list_draft_versions(
    app: tauri::AppHandle,
    chapter_id: String,
    project_id: String,
) -> Result<Vec<DraftVersionBrief>, AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &chapter_id, &project_id)?;
        draft::list_versions(state, &chapter_id)
    })
    .await
}

#[tauri::command]
pub async fn get_draft_version(
    app: tauri::AppHandle,
    id: String,
    project_id: String,
) -> Result<DraftVersion, AppError> {
    blocking(app, move |state| {
        ownership::assert_version(state, &id, &project_id)?;
        draft::get_version(state, &id)
    })
    .await
}

#[tauri::command]
pub async fn restore_draft_version(
    app: tauri::AppHandle,
    id: String,
    expected_content_revision: Option<i64>,
    project_id: String,
) -> Result<ChapterContent, AppError> {
    blocking(app, move |state| {
        ownership::assert_version(state, &id, &project_id)?;
        draft::restore_version(state, &id, expected_content_revision)
    })
    .await
}
