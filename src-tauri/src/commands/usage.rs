//! 用量看板命令：只做 IPC 适配，聚合逻辑在 service 里。
use tauri::State;

use crate::infrastructure::db::DbState;
use crate::services::usage::{self, UsageStats};

#[tauri::command]
pub fn usage_stats(state: State<'_, DbState>) -> Result<UsageStats, String> {
    usage::stats(&state)
}
