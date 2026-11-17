//! 钥匙串命令：密钥经此写入系统钥匙串，前端只传引用键名与值（值走 IPC 一次性写入）。

use crate::infrastructure::keychain;

#[tauri::command]
pub fn keychain_set(key: String, value: String) -> Result<(), String> {
    keychain::set(&key, &value)
}

#[tauri::command]
pub fn keychain_get(key: String) -> Result<Option<String>, String> {
    keychain::get(&key)
}

#[tauri::command]
pub fn keychain_delete(key: String) -> Result<(), String> {
    keychain::delete(&key)
}
