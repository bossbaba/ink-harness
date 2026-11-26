//! 设定库命令层：薄适配，调 story_element service。
//!
//! 按 id 读/改/删单条设定的命令都要求声明作品，并在进入 service 前核对归属；
//! 列表类命令本来就带 projectId，不需要额外校验。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{ConsistencyIssue, NewStoryElement, StoryElement, StoryElementOverview};
use crate::services::{ownership, story_element};

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
    project_id: String,
) -> Result<Option<StoryElement>, AppError> {
    blocking(app, move |state| {
        // 归属不符与记录不存在都按「查不到」处理，不泄漏别的作品里有没有这条设定。
        // 数据库故障必须原样往上抛：它是 not_found 之外的错误码，不能被伪装成空结果。
        match ownership::assert_element(state, &id, &project_id) {
            Ok(()) => story_element::get(state, &id),
            Err(err) if err.code() == "not_found" => Ok(None),
            Err(err) => Err(err),
        }
    })
    .await
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
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        // 更新请求体自带 project_id，先确保它与调用方声明的一致，再确认库中归属。
        if element.project_id != project_id {
            return Err(AppError::validation("设定条目不属于当前作品"));
        }
        ownership::assert_element(state, &element.id, &project_id)?;
        story_element::update(state, &element)
    })
    .await
}

#[tauri::command]
pub async fn delete_story_element(
    app: tauri::AppHandle,
    id: String,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_element(state, &id, &project_id)?;
        story_element::remove(state, &id)
    })
    .await
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
