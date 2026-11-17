//! 作品命令层：薄适配，调 project service。

use tauri::State;

use crate::infrastructure::db::DbState;
use crate::models::{DatabaseInfo, NewProject, Project};
use crate::services::project;

#[tauri::command]
pub fn database_info(state: State<'_, DbState>) -> Result<DatabaseInfo, String> {
    Ok(project::database_info(&state))
}

#[tauri::command]
pub fn list_projects(state: State<'_, DbState>) -> Result<Vec<Project>, String> {
    project::list(&state)
}

#[tauri::command]
pub fn get_project(state: State<'_, DbState>, id: String) -> Result<Option<Project>, String> {
    project::get(&state, &id)
}

#[tauri::command]
pub fn create_project(state: State<'_, DbState>, input: NewProject) -> Result<Project, String> {
    project::create(&state, input)
}

#[tauri::command]
pub fn update_project(state: State<'_, DbState>, project: Project) -> Result<(), String> {
    project::update(&state, &project)
}

#[tauri::command]
pub fn delete_project(state: State<'_, DbState>, id: String) -> Result<(), String> {
    project::remove(&state, &id)
}
