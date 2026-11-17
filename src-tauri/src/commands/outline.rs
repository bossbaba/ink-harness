//! 大纲命令层：薄适配，仅透传参数到 service。

use tauri::State;

use crate::infrastructure::db::DbState;
use crate::models::{
    Chapter, Foreshadow, MoveChapter, MoveScene, NewChapter, NewForeshadow, NewScene,
    OutlineSnapshot, Scene,
};
use crate::services::{outline, outline_context};

#[tauri::command]
pub fn outline_snapshot(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<OutlineSnapshot, String> {
    outline::snapshot(&state, &project_id)
}

#[tauri::command]
pub fn create_chapter(state: State<'_, DbState>, input: NewChapter) -> Result<Chapter, String> {
    outline::create_chapter(&state, input)
}

#[tauri::command]
pub fn update_chapter(state: State<'_, DbState>, chapter: Chapter) -> Result<(), String> {
    outline::update_chapter(&state, &chapter)
}

#[tauri::command]
pub fn delete_chapter(state: State<'_, DbState>, id: String) -> Result<(), String> {
    outline::delete_chapter(&state, &id)
}

#[tauri::command]
pub fn create_scene(state: State<'_, DbState>, input: NewScene) -> Result<Scene, String> {
    outline::create_scene(&state, input)
}

#[tauri::command]
pub fn update_scene(state: State<'_, DbState>, scene: Scene) -> Result<(), String> {
    outline::update_scene(&state, &scene)
}

#[tauri::command]
pub fn delete_scene(state: State<'_, DbState>, id: String) -> Result<(), String> {
    outline::delete_scene(&state, &id)
}

#[tauri::command]
pub fn create_foreshadow(
    state: State<'_, DbState>,
    input: NewForeshadow,
) -> Result<Foreshadow, String> {
    outline::create_foreshadow(&state, input)
}

#[tauri::command]
pub fn update_foreshadow(state: State<'_, DbState>, foreshadow: Foreshadow) -> Result<(), String> {
    outline::update_foreshadow(&state, &foreshadow)
}

#[tauri::command]
pub fn delete_foreshadow(state: State<'_, DbState>, id: String) -> Result<(), String> {
    outline::delete_foreshadow(&state, &id)
}

#[tauri::command]
pub fn move_chapter(state: State<'_, DbState>, input: MoveChapter) -> Result<(), String> {
    outline::move_chapter(&state, &input)
}

#[tauri::command]
pub fn move_scene(state: State<'_, DbState>, input: MoveScene) -> Result<(), String> {
    outline::move_scene(&state, &input)
}

#[tauri::command]
pub fn build_project_context(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<String, String> {
    outline_context::build_context(&state, &project_id)
}
