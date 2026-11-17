//! Ollama 检测命令。

use crate::models::OllamaStatus;
use crate::services::ollama;

#[tauri::command]
pub async fn check_ollama() -> Result<OllamaStatus, String> {
    ollama::check().await
}
