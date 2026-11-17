//! 写作台命令层：薄适配，只把参数透传给 service。

use tauri::State;

use crate::infrastructure::db::DbState;
use crate::models::{ChapterContent, DraftVersion, DraftVersionBrief, SaveContentInput};
use crate::services::draft;

#[tauri::command]
pub fn get_chapter_content(
    state: State<'_, DbState>,
    chapter_id: String,
) -> Result<ChapterContent, String> {
    draft::get_content(&state, &chapter_id)
}

#[tauri::command]
pub fn save_chapter_content(
    state: State<'_, DbState>,
    input: SaveContentInput,
) -> Result<ChapterContent, String> {
    draft::save_content(&state, input)
}

#[tauri::command]
pub fn list_draft_versions(
    state: State<'_, DbState>,
    chapter_id: String,
) -> Result<Vec<DraftVersionBrief>, String> {
    draft::list_versions(&state, &chapter_id)
}

#[tauri::command]
pub fn get_draft_version(state: State<'_, DbState>, id: String) -> Result<DraftVersion, String> {
    draft::get_version(&state, &id)
}

#[tauri::command]
pub fn restore_draft_version(
    state: State<'_, DbState>,
    id: String,
) -> Result<ChapterContent, String> {
    draft::restore_version(&state, &id)
}
