//! Provider 管理与流式对话命令：只做 Tauri IPC 与 service 之间的适配。

use tauri::ipc::Channel;
use tauri::State;

use crate::models::{ChatChunk, ChatParams, ProviderConfig};
use crate::services::gateway::{self, GatewayState};

#[tauri::command]
pub fn list_providers(state: State<'_, GatewayState>) -> Result<Vec<ProviderConfig>, String> {
    gateway::list_providers(&state)
}

#[tauri::command]
pub fn save_provider(state: State<'_, GatewayState>, config: ProviderConfig) -> Result<(), String> {
    gateway::save_provider(&state, config)
}

#[tauri::command]
pub fn remove_provider(state: State<'_, GatewayState>, id: String) -> Result<(), String> {
    gateway::remove_provider(&state, &id)
}

#[tauri::command]
pub async fn chat_completions(
    state: State<'_, GatewayState>,
    params: ChatParams,
    on_chunk: Channel<ChatChunk>,
) -> Result<(), String> {
    // 把 service 的回调适配到 Channel；service 本身不认识 Tauri。
    gateway::stream_chat(&state, &params, |chunk| {
        let _ = on_chunk.send(chunk);
    })
    .await
}
