//! 用量看板命令：只做 IPC 适配，聚合逻辑在 service 里。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::UsageStats;
use crate::services::usage;

#[tauri::command]
pub async fn usage_stats(app: tauri::AppHandle) -> Result<UsageStats, AppError> {
    blocking(app, |state| usage::stats(state)).await
}
