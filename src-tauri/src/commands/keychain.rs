//! 钥匙串命令：密钥经此写入系统钥匙串，前端只传引用键名与值（值走 IPC 一次性写入）。
//!
//! 刻意不提供「读密钥」命令：明文一旦能通过 IPC 取回，渲染进程里的任意脚本
//! 就能配合 `list_providers` 返回的 apiKeyRef 把全部密钥读走。密钥只允许在
//! 后端 `gateway`/`embed` 内部按引用读取使用。
//!
//! 系统钥匙串访问是阻塞 IO（可能弹授权框、可能超时），因此放到阻塞线程池。

use crate::commands::blocking;
use crate::error::AppError;
use crate::infrastructure::keychain;

#[tauri::command]
pub async fn keychain_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), AppError> {
    blocking(app, move |_state| keychain::set(&key, &value)).await
}

#[tauri::command]
pub async fn keychain_delete(app: tauri::AppHandle, key: String) -> Result<(), AppError> {
    blocking(app, move |_state| keychain::delete(&key)).await
}

/// 只回「有没有」，不把明文取回渲染进程；编辑弹窗据此校准「已保存密钥」标签。
#[tauri::command]
pub async fn keychain_has(app: tauri::AppHandle, key: String) -> Result<bool, AppError> {
    blocking(app, move |_state| keychain::exists(Some(&key))).await
}
