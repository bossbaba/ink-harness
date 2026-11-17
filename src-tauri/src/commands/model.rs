//! Provider 管理与流式对话命令：只做 Tauri IPC 与 service 之间的适配。

use tauri::ipc::Channel;
use tauri::State;

use crate::infrastructure::db::DbState;
use crate::models::{ChatChunk, ChatParams, ProbeProviderInput, ProviderConfig};
use crate::services::{gateway, provider};

#[tauri::command]
pub fn list_providers(state: State<'_, DbState>) -> Result<Vec<ProviderConfig>, String> {
    provider::list(&state)
}

#[tauri::command]
pub fn save_provider(
    state: State<'_, DbState>,
    config: ProviderConfig,
) -> Result<ProviderConfig, String> {
    provider::save(&state, &config)
}

#[tauri::command]
pub fn remove_provider(state: State<'_, DbState>, id: String) -> Result<(), String> {
    provider::remove(&state, &id)
}

/// 探测连接并拉取模型列表；允许在保存前用未落库的 API Key 测试。
#[tauri::command]
pub async fn probe_provider(input: ProbeProviderInput) -> Result<Vec<String>, String> {
    provider::probe(&input).await
}

#[tauri::command]
pub async fn chat_completions(
    state: State<'_, DbState>,
    params: ChatParams,
    on_chunk: Channel<ChatChunk>,
) -> Result<(), String> {
    // 把 service 的回调适配到 Channel；service 本身不认识 Tauri。
    gateway::stream_chat(&state, &params, |chunk| {
        let _ = on_chunk.send(chunk);
    })
    .await
}
