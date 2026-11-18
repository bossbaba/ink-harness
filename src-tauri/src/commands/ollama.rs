//! Ollama 检测与启动命令。

use crate::error::AppError;
use crate::models::OllamaStatus;
use crate::services::ollama;

#[tauri::command]
pub async fn check_ollama() -> Result<OllamaStatus, AppError> {
    ollama::check().await
}

/// 从程序内启动本地模型：拉起桌面版 App 或 `ollama serve`，等到服务可用才返回。
#[tauri::command]
pub async fn start_ollama() -> Result<OllamaStatus, AppError> {
    ollama::start().await
}
