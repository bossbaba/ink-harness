//! 统一错误类型。
//!
//! 这个类型会直接跨 IPC 序列化成 `{ code, message }`：
//! - `code` 给前端做分支（重试 / 提示 / 跳转），不要求前端比对中文文案；
//! - `message` 保持中文可读，继续用现成的展示位，不额外翻译。
//!
//! 内部实现刻意保留 `From<String>`：service 里大量既有 `map_err(|e| e.to_string())?`
//! 可以原样保留并继续编译，先让类型统一，再逐步把关键路径换成带语义的构造器
//! （`AppError::db` / `not_found` / `validation` / `network`）。这样可以分批推进，
//! 而不是一次性重写两百多处错误转换。

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// 错误分类。新增分类时同步更新 `as_str` 与前端 `src/utils/errors.ts` 的映射表。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// 入参或业务规则不满足，重试无用，需要用户改输入。
    Validation,
    /// 记录不存在（或已被删除）。
    NotFound,
    /// 并发/状态冲突，通常可以提示用户刷新后重试。
    Conflict,
    /// 数据库故障（锁等待超时、只读、磁盘满等）。
    Db,
    /// 网络层失败（连不上、超时）。
    Network,
    /// 上游返回了错误状态码。
    Upstream,
    /// 其它未分类的内部错误。
    Internal,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Validation => "validation",
            ErrorCode::NotFound => "not_found",
            ErrorCode::Conflict => "conflict",
            ErrorCode::Db => "db",
            ErrorCode::Network => "network",
            ErrorCode::Upstream => "upstream",
            ErrorCode::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Conflict, message)
    }

    pub fn db(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Db, message)
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Network, message)
    }

    pub fn upstream(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Upstream, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    /// 给前端分支用的稳定标识。
    pub fn code(&self) -> &'static str {
        self.code.as_str()
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code.as_str())?;
        state.serialize_field("message", &self.message)?;
        state.end()
    }
}

/// 过渡通道：service 内部已有的中文错误串直接透传，分类记为 internal。
impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::internal(message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::db(format!("数据库操作失败：{err}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::internal(format!("文件读写失败：{err}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal(format!("JSON 解析失败：{err}"))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        // 超时/断开归网络类，4xx/5xx 由调用方用 `AppError::upstream` 单独包装。
        if err.is_timeout() || err.is_connect() || err.is_request() {
            Self::network(format!("网络请求失败：{err}"))
        } else {
            Self::internal(format!("请求处理失败：{err}"))
        }
    }
}

/// 让单测可以继续 `assert_eq!(err, "xxx")`，不必逐个改成 `.message`。
impl PartialEq<&str> for AppError {
    fn eq(&self, other: &&str) -> bool {
        self.message == *other
    }
}

impl PartialEq<String> for AppError {
    fn eq(&self, other: &String) -> bool {
        &self.message == other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_message() {
        let err = AppError::not_found("章节不存在");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "not_found");
        assert_eq!(json["message"], "章节不存在");
    }

    #[test]
    fn string_errors_keep_message() {
        let err = AppError::from("任意旧文案".to_string());
        assert_eq!(err.code, ErrorCode::Internal);
        assert_eq!(err, "任意旧文案");
    }

    #[test]
    fn rusqlite_errors_are_coded_as_db() {
        let err = AppError::from(rusqlite::Error::InvalidQuery);
        assert_eq!(err.code(), "db");
        assert!(err.message.contains("数据库操作失败"));
    }

    #[test]
    fn display_is_plain_message() {
        assert_eq!(AppError::validation("标题不能为空").to_string(), "标题不能为空");
    }
}
