//! Provider 管理与流式对话命令：只做 Tauri IPC 与 service 之间的适配。

use std::sync::Arc;

use tauri::ipc::Channel;

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{ChatChunk, ChatParams, ProbeProviderInput, ProviderConfig};
use crate::services::cancel::CancelRegistry;
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
pub async fn probe_provider(
    state: tauri::State<'_, crate::infrastructure::db::DbState>,
    input: ProbeProviderInput,
) -> Result<Vec<String>, AppError> {
    provider::probe(&state, &input).await
}

#[tauri::command]
pub async fn chat_completions(
    state: tauri::State<'_, crate::infrastructure::db::DbState>,
    cancels: tauri::State<'_, Arc<CancelRegistry>>,
    params: ChatParams,
    on_chunk: Channel<ChatChunk>,
) -> Result<(), AppError> {
    // 按 requestId 注册取消标志；guard 离开作用域自动摘除，避免表随请求数无限增长。
    let guard = cancels.register(params.request_id.as_deref());
    let flag = guard.flag();
    // 两条取消路径：Channel 接收端断开（旧行为），或前端显式调 cancel_chat。
    // 都返回 false，让网关在下个检查点退出并释放 reqwest 连接，而不是继续烧 token。
    chat::stream_with_usage(
        &state,
        &params,
        |chunk| !flag.is_cancelled() && on_chunk.send(chunk).is_ok(),
        Some(flag.clone()),
    )
    .await
}

/// 前端「停止」按钮：按 requestId 置位取消标志。
///
/// 幂等空操作：请求可能已正常结束（标志已被 guard 摘除），这时不需要报错。
#[tauri::command]
pub fn cancel_chat(
    request_id: String,
    cancels: tauri::State<'_, Arc<CancelRegistry>>,
) -> Result<(), AppError> {
    cancels.cancel(&request_id);
    Ok(())
}
