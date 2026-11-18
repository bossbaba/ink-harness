//! 应用级设置命令：键值读写，前端只关心字符串。

use crate::commands::blocking;
use crate::error::AppError;
use crate::services::setting;

#[tauri::command]
pub async fn get_app_setting(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, AppError> {
    blocking(app, move |state| setting::get(state, &key)).await
}

#[tauri::command]
pub async fn set_app_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), AppError> {
    blocking(app, move |state| setting::set(state, &key, &value)).await
}
