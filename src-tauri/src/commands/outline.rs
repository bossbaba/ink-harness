//! 大纲命令层：薄适配，仅透传参数到 service。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{
    Chapter, Foreshadow, MoveChapter, MoveScene, NewChapter, NewForeshadow, NewScene,
    OutlineSnapshot, Scene,
};
use crate::services::{outline, outline_context};

#[tauri::command]
pub async fn outline_snapshot(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<OutlineSnapshot, AppError> {
    blocking(app, move |state| outline::snapshot(state, &project_id)).await
}

#[tauri::command]
pub async fn create_chapter(app: tauri::AppHandle, input: NewChapter) -> Result<Chapter, AppError> {
    blocking(app, move |state| outline::create_chapter(state, input)).await
}

#[tauri::command]
pub async fn update_chapter(app: tauri::AppHandle, chapter: Chapter) -> Result<(), AppError> {
    blocking(app, move |state| outline::update_chapter(state, &chapter)).await
}

/// 只改摘要：摘要自动生成、频率高，单独一条命令避免整对象覆盖标题/幕次/状态。
#[tauri::command]
pub async fn update_chapter_summary(
    app: tauri::AppHandle,
    id: String,
    summary: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        outline::update_chapter_summary(state, &id, &summary)
    })
    .await
}

#[tauri::command]
pub async fn delete_chapter(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| outline::delete_chapter(state, &id)).await
}

#[tauri::command]
pub async fn create_scene(app: tauri::AppHandle, input: NewScene) -> Result<Scene, AppError> {
    blocking(app, move |state| outline::create_scene(state, input)).await
}

#[tauri::command]
pub async fn update_scene(app: tauri::AppHandle, scene: Scene) -> Result<(), AppError> {
    blocking(app, move |state| outline::update_scene(state, &scene)).await
}

#[tauri::command]
pub async fn delete_scene(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| outline::delete_scene(state, &id)).await
}

#[tauri::command]
pub async fn create_foreshadow(
    app: tauri::AppHandle,
    input: NewForeshadow,
) -> Result<Foreshadow, AppError> {
    blocking(app, move |state| outline::create_foreshadow(state, input)).await
}

#[tauri::command]
pub async fn update_foreshadow(
    app: tauri::AppHandle,
    foreshadow: Foreshadow,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        outline::update_foreshadow(state, &foreshadow)
    })
    .await
}

#[tauri::command]
pub async fn delete_foreshadow(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| outline::delete_foreshadow(state, &id)).await
}

#[tauri::command]
pub async fn move_chapter(app: tauri::AppHandle, input: MoveChapter) -> Result<(), AppError> {
    blocking(app, move |state| outline::move_chapter(state, &input)).await
}

#[tauri::command]
pub async fn move_scene(app: tauri::AppHandle, input: MoveScene) -> Result<(), AppError> {
    blocking(app, move |state| outline::move_scene(state, &input)).await
}

#[tauri::command]
pub async fn build_project_context(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<String, AppError> {
    blocking(app, move |state| {
        outline_context::build_context(state, &project_id)
    })
    .await
}
