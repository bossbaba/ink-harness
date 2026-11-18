//! Provider 管理与流式对话命令：只做 Tauri IPC 与 service 之间的适配。

use tauri::ipc::Channel;

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{ChatChunk, ChatParams, ProbeProviderInput, ProviderConfig};
use crate::services::{chat, provider};

#[tauri::command]
pub async fn list_providers(app: tauri::AppHandle) -> Result<Vec<ProviderConfig>, AppError> {
    blocking(app, |state| provider::list(state)).await
}

#[tauri::command]
pub async fn save_provider(
    app: tauri::AppHandle,
    config: ProviderConfig,
) -> Result<ProviderConfig, AppError> {
    blocking(app, move |state| provider::save(state, &config)).await
}

#[tauri::command]
pub async fn remove_provider(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| provider::remove(state, &id)).await
}

/// 探测连接并拉取模型列表；允许在保存前用未落库的 API Key 测试。
#[tauri::command]
pub async fn probe_provider(input: ProbeProviderInput) -> Result<Vec<String>, AppError> {
    provider::probe(&input).await
}

#[tauri::command]
pub async fn chat_completions(
    state: tauri::State<'_, crate::infrastructure::db::DbState>,
    params: ChatParams,
    on_chunk: Channel<ChatChunk>,
) -> Result<(), AppError> {
    // 只做 IPC 适配：send 失败说明用户已取消，返回 false 让 service 停止读取与计费。
    chat::stream_with_usage(&state, &params, |chunk| on_chunk.send(chunk).is_ok()).await
}
