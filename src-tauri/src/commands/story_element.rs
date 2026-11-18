//! 设定库命令层：薄适配，调 story_element service。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{ConsistencyIssue, NewStoryElement, StoryElement, StoryElementOverview};
use crate::services::story_element;

#[tauri::command]
pub async fn list_story_elements(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<StoryElement>, AppError> {
    blocking(app, move |state| story_element::list(state, &project_id)).await
}

#[tauri::command]
pub async fn list_all_story_elements(
    app: tauri::AppHandle,
) -> Result<Vec<StoryElementOverview>, AppError> {
    blocking(app, |state| story_element::list_all(state)).await
}

#[tauri::command]
pub async fn get_story_element(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<StoryElement>, AppError> {
    blocking(app, move |state| story_element::get(state, &id)).await
}

#[tauri::command]
pub async fn create_story_element(
    app: tauri::AppHandle,
    input: NewStoryElement,
) -> Result<StoryElement, AppError> {
    blocking(app, move |state| story_element::create(state, input)).await
}

#[tauri::command]
pub async fn update_story_element(
    app: tauri::AppHandle,
    element: StoryElement,
) -> Result<(), AppError> {
    blocking(app, move |state| story_element::update(state, &element)).await
}

#[tauri::command]
pub async fn delete_story_element(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| story_element::remove(state, &id)).await
}

#[tauri::command]
pub async fn check_story_consistency(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<ConsistencyIssue>, AppError> {
    blocking(app, move |state| {
        story_element::check_consistency(state, &project_id)
    })
    .await
}
