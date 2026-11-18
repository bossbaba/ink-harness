//! 全局统计命令：只做 IPC 适配，聚合逻辑在 service 里。
use tauri::State;

use crate::infrastructure::db::DbState;
use crate::services::stats::{self, WorkspaceStats};

#[tauri::command]
pub fn workspace_stats(state: State<'_, DbState>) -> Result<WorkspaceStats, String> {
    stats::workspace_stats(&state)
}
