//! 全局统计命令：只做 IPC 适配，聚合逻辑在 service 里。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::WorkspaceStats;
use crate::services::stats;

#[tauri::command]
pub async fn workspace_stats(app: tauri::AppHandle) -> Result<WorkspaceStats, AppError> {
    blocking(app, |state| stats::workspace_stats(state)).await
}
