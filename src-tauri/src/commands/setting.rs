//! 应用级设置命令：键值读写，前端只关心字符串。

use tauri::State;

use crate::infrastructure::db::DbState;
use crate::services::setting;

#[tauri::command]
pub fn get_app_setting(state: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    setting::get(&state, &key)
}

#[tauri::command]
pub fn set_app_setting(
    state: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    setting::set(&state, &key, &value)
}
