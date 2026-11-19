//! HTTP 基础设施：为 LLM 请求与 Ollama 探测提供统一的 client 构造。

use crate::error::AppError;
use std::time::Duration;

/// 构造 LLM HTTP 客户端：限制 TCP 建连时间，避免上游不可达时命令长期挂起。
/// 读超时按场景由调用方设置（探测 12 秒，SSE 用空闲超时），这里只管连接阶段。
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn probe_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(AppError::from)
}

pub const OLLAMA_TAGS_URL: &str = "http://localhost:11434/api/tags";

/// 单次请求最多尝试几次（首次 + 2 次重试）。
pub const MAX_ATTEMPTS: u32 = 3;

/// 指数退避：第 1 次失败等 400ms，第 2 次 800ms。
/// 只对连接失败/限流/5xx 生效，鉴权与参数错误重试也没用，调用方会直接返回。
pub fn backoff(attempt: u32) -> Duration {
    Duration::from_millis(400 * 2u64.pow(attempt.min(4)))
}

/// 上游状态码是否值得重试：限流与 5xx 是临时故障，4xx 是调用方问题。
pub fn retryable_status(status: reqwest::StatusCode) -> bool {
    status.as_u16() == 429 || status.is_server_error()
}

/// 网络错误是否值得重试：超时与连不上都是临时的；请求构造错误重试无意义。
pub fn retryable_error(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_is_exponential_and_capped() {
        assert_eq!(backoff(0).as_millis(), 400);
        assert_eq!(backoff(1).as_millis(), 800);
        assert_eq!(backoff(2).as_millis(), 1600);
        // attempt 超过 4 后封顶，避免指数爆炸导致重试等到天荒地老。
        assert_eq!(backoff(10).as_millis(), backoff(4).as_millis());
    }

    #[test]
    fn retryable_status_only_rate_limit_and_server_error() {
        assert!(retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(retryable_status(reqwest::StatusCode::INTERNAL_SERVER_ERROR));
        assert!(retryable_status(reqwest::StatusCode::BAD_GATEWAY));
        // 4xx 是调用方问题（鉴权/参数错误），重试无意义。
        assert!(!retryable_status(reqwest::StatusCode::UNAUTHORIZED));
        assert!(!retryable_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!retryable_status(reqwest::StatusCode::OK));
    }
}
