//! 设定库命令层：薄适配，调 story_element service。

use tauri::State;

use crate::infrastructure::db::DbState;
use crate::models::{ConsistencyIssue, NewStoryElement, StoryElement, StoryElementOverview};
use crate::services::story_element;

#[tauri::command]
pub fn list_story_elements(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<StoryElement>, String> {
    story_element::list(&state, &project_id)
}

#[tauri::command]
pub fn list_all_story_elements(
    state: State<'_, DbState>,
) -> Result<Vec<StoryElementOverview>, String> {
    story_element::list_all(&state)
}

#[tauri::command]
pub fn get_story_element(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<StoryElement>, String> {
    story_element::get(&state, &id)
}

#[tauri::command]
pub fn create_story_element(
    state: State<'_, DbState>,
    input: NewStoryElement,
) -> Result<StoryElement, String> {
    story_element::create(&state, input)
}

#[tauri::command]
pub fn update_story_element(
    state: State<'_, DbState>,
    element: StoryElement,
) -> Result<(), String> {
    story_element::update(&state, &element)
}

#[tauri::command]
pub fn delete_story_element(state: State<'_, DbState>, id: String) -> Result<(), String> {
    story_element::remove(&state, &id)
}

#[tauri::command]
pub fn check_story_consistency(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<ConsistencyIssue>, String> {
    story_element::check_consistency(&state, &project_id)
}
