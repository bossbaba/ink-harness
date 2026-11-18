//! 系统钥匙串封装。密钥只在这里读写，绝不进入前端或日志。

use crate::error::AppError;

const SERVICE_NAME: &str = "com.inkharness.app";

fn entry(key: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE_NAME, key)
        .map_err(|err| AppError::internal(format!("访问系统钥匙串失败：{err}")))
}

pub fn set(key: &str, value: &str) -> Result<(), AppError> {
    entry(key)?
        .set_password(value)
        .map_err(|err| AppError::internal(format!("写入系统钥匙串失败：{err}")))
}

pub fn get(key: &str) -> Result<Option<String>, AppError> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::internal(format!("读取系统钥匙串失败：{e}"))),
    }
}

pub fn delete(key: &str) -> Result<(), AppError> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        // 本来就不存在视为删除成功：清理密钥的操作要幂等。
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::internal(format!("删除系统钥匙串失败：{e}"))),
    }
}

/// 按引用键读取可选密钥：未配置返回 None；读取失败也返回 None，但在这里留下根因日志。
/// 调用方因此不必各自重复「取密钥 + 吞错误 + 打日志」，也不会把钥匙串故障误报成上游 401。
pub fn optional(reference: Option<&str>) -> Option<String> {
    let key = reference?;
    match get(key) {
        Ok(value) => value,
        Err(err) => {
            eprintln!("读取 API Key 引用 {key} 失败：{err}");
            None
        }
    }
}
