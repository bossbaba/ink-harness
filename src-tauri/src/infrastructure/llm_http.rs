//! HTTP 基础设施：为 LLM 请求与 Ollama 探测提供统一的 client 构造。

use std::time::Duration;

pub fn client() -> reqwest::Client {
    reqwest::Client::new()
}

pub fn probe_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())
}

pub const OLLAMA_TAGS_URL: &str = "http://localhost:11434/api/tags";
