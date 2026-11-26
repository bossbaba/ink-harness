//! 大纲命令层：薄适配，先做归属校验，再把参数透传到 service。
//!
//! 按 id 改/删的命令都要求显式声明作品：service 只按 id 定位行，不知道调用方
//! 代表哪个作品；把作用域放在命令签名上，漏传就会编译不过，而不是静默串数据。
//! 校验实现放在 services/ownership，命令层只调用、不写 SQL。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{
    Chapter, Foreshadow, MoveChapter, MoveScene, NewChapter, NewForeshadow, NewScene,
    OutlineSnapshot, Scene,
};
use crate::services::{outline, outline_context, ownership};

#[tauri::command]
pub async fn outline_snapshot(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<OutlineSnapshot, AppError> {
    blocking(app, move |state| outline::snapshot(state, &project_id)).await
}

#[tauri::command]
pub async fn create_chapter(app: tauri::AppHandle, input: NewChapter) -> Result<Chapter, AppError> {
    blocking(app, move |state| {
        ownership::assert_project(state, &input.project_id)?;
        outline::create_chapter(state, input)
    })
    .await
}

#[tauri::command]
pub async fn update_chapter(app: tauri::AppHandle, chapter: Chapter) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &chapter.id, &chapter.project_id)?;
        outline::update_chapter(state, &chapter)
    })
    .await
}

/// 只改摘要：摘要自动生成、频率高，单独一条命令避免整对象覆盖标题/幕次/状态。
#[tauri::command]
pub async fn update_chapter_summary(
    app: tauri::AppHandle,
    id: String,
    summary: String,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &id, &project_id)?;
        outline::update_chapter_summary(state, &id, &summary)
    })
    .await
}

#[tauri::command]
pub async fn delete_chapter(
    app: tauri::AppHandle,
    id: String,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &id, &project_id)?;
        outline::delete_chapter(state, &id)
    })
    .await
}

#[tauri::command]
pub async fn create_scene(
    app: tauri::AppHandle,
    input: NewScene,
    project_id: String,
) -> Result<Scene, AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &input.chapter_id, &project_id)?;
        outline::create_scene(state, input)
    })
    .await
}

#[tauri::command]
pub async fn update_scene(
    app: tauri::AppHandle,
    scene: Scene,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_scene(state, &scene.id, &project_id)?;
        outline::update_scene(state, &scene)
    })
    .await
}

#[tauri::command]
pub async fn delete_scene(
    app: tauri::AppHandle,
    id: String,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_scene(state, &id, &project_id)?;
        outline::delete_scene(state, &id)
    })
    .await
}

#[tauri::command]
pub async fn create_foreshadow(
    app: tauri::AppHandle,
    input: NewForeshadow,
) -> Result<Foreshadow, AppError> {
    blocking(app, move |state| {
        ownership::assert_project(state, &input.project_id)?;
        outline::create_foreshadow(state, input)
    })
    .await
}

#[tauri::command]
pub async fn update_foreshadow(
    app: tauri::AppHandle,
    foreshadow: Foreshadow,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_foreshadow(state, &foreshadow.id, &foreshadow.project_id)?;
        outline::update_foreshadow(state, &foreshadow)
    })
    .await
}

#[tauri::command]
pub async fn delete_foreshadow(
    app: tauri::AppHandle,
    id: String,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_foreshadow(state, &id, &project_id)?;
        outline::delete_foreshadow(state, &id)
    })
    .await
}

#[tauri::command]
pub async fn move_chapter(app: tauri::AppHandle, input: MoveChapter) -> Result<(), AppError> {
    blocking(app, move |state| {
        ownership::assert_chapter(state, &input.chapter_id, &input.project_id)?;
        outline::move_chapter(state, &input)
    })
    .await
}

#[tauri::command]
pub async fn move_scene(
    app: tauri::AppHandle,
    input: MoveScene,
    project_id: String,
) -> Result<(), AppError> {
    blocking(app, move |state| {
        // 源场景与目标章节都要核：否则可以把别的作品的场景挂到当前作品的章节下。
        ownership::assert_scene(state, &input.scene_id, &project_id)?;
        ownership::assert_chapter(state, &input.target_chapter_id, &project_id)?;
        outline::move_scene(state, &input)
    })
    .await
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
