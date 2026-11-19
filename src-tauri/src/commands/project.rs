//! 作品命令层：薄适配，调 project service。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{DatabaseInfo, NewProject, Project};
use crate::services::project;

#[tauri::command]
pub async fn database_info(app: tauri::AppHandle) -> Result<DatabaseInfo, AppError> {
    blocking(app, |state| Ok(project::database_info(state))).await
}

#[tauri::command]
pub async fn list_projects(app: tauri::AppHandle) -> Result<Vec<Project>, AppError> {
    blocking(app, |state| project::list(state)).await
}

#[tauri::command]
pub async fn get_project(app: tauri::AppHandle, id: String) -> Result<Option<Project>, AppError> {
    blocking(app, move |state| project::get(state, &id)).await
}

#[tauri::command]
pub async fn create_project(app: tauri::AppHandle, input: NewProject) -> Result<Project, AppError> {
    blocking(app, move |state| project::create(state, input)).await
}

#[tauri::command]
pub async fn update_project(app: tauri::AppHandle, project: Project) -> Result<(), AppError> {
    blocking(app, move |state| project::update(state, &project)).await
}

#[tauri::command]
pub async fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| project::remove(state, &id)).await
}
