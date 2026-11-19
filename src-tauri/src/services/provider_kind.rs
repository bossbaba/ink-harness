//! Provider 方言：把「打哪个 URL、按什么格式解析模型列表」集中到这里。
//!
//! 之前这些判断散在三处：`gateway` 拼 `/chat/completions`、`provider` 探测三个候选地址、
//! `embed` 拼 `/embeddings`。接一家新的模型厂商要改三四个文件，还容易漏。
//! 现在协议差异只在本文件里出现，新增方言（如 Anthropic 的 `/v1/messages`）
//! 只需在这里加一个分支，调用方不用动。

/// Provider 来源标识：本地跑在自己机器上的服务，可以接收「仅本地」作品的正文。
pub const SOURCE_LOCAL: &str = "local";

/// 判断 Provider 是否是本地服务。`source` 字段是库里的自由字符串，统一在这里比对。
pub fn is_local(source: &str) -> bool {
    source == SOURCE_LOCAL
}

/// 对话接口地址。
///
/// OpenAI 兼容协议统一是 `/chat/completions`；Ollama 的 `/v1` 前缀说的也是这套协议，
/// 所以不需要按厂商分支。注意思考型模型在该端点上会把输出全放进 `reasoning` 字段，
/// 这种情况由 [`native_chat_url`] 走原生协议处理。
pub fn chat_url(base_url: &str) -> String {
    format!("{}/chat/completions", trim(base_url))
}

/// Ollama 原生对话地址：把 `/v1` 去掉后拼 `/api/chat`。
/// 原生接口支持 `think: false`，能让思考型模型直接输出正文，而不是把内容塞进 reasoning 字段。
pub fn native_chat_url(base_url: &str) -> String {
    let base = trim(base_url);
    let base = base.strip_suffix("/v1").unwrap_or(base);
    format!("{base}/api/chat")
}

/// 是否应该走 Ollama 原生协议。只识别本地 Provider 的默认端口：
/// 其他本地 OpenAI 兼容服务（llama.cpp 等）仍走通用 SSE 分支，避免误判。
pub fn is_ollama_native(source: &str, base_url: &str) -> bool {
    if !is_local(source) {
        return false;
    }
    let base = trim(base_url);
    base.contains("://localhost:11434") || base.contains("://127.0.0.1:11434")
}

/// embedding 接口地址（同样走 OpenAI 兼容协议）。
pub fn embeddings_url(base_url: &str) -> String {
    format!("{}/embeddings", trim(base_url))
}

/// 探测模型列表时依次尝试的地址。
///
/// Ollama 原生接口是 `/api/tags`，OpenAI 兼容的是 `/models`；
/// `base_url` 已经带 `/v1` 时不再拼 `/v1/models`，避免出现 `/v1/v1/models`。
pub fn model_list_urls(base_url: &str) -> Vec<String> {
    let base = trim(base_url);
    let mut urls = vec![format!("{base}/models")];
    if !base.ends_with("/v1") {
        urls.push(format!("{base}/v1/models"));
    }
    urls.push(format!("{base}/api/tags"));
    urls
}

fn trim(base_url: &str) -> &str {
    base_url.trim().trim_end_matches('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_and_embeddings_urls_strip_trailing_slash() {
        assert_eq!(
            chat_url("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            embeddings_url("http://api.example.com/v1"),
            "http://api.example.com/v1/embeddings"
        );
    }

    #[test]
    fn model_list_skips_duplicate_v1_prefix() {
        let urls = model_list_urls("http://localhost:11434/v1");
        assert_eq!(urls[0], "http://localhost:11434/v1/models");
        assert!(!urls.iter().any(|url| url.contains("/v1/v1/")));
        assert_eq!(urls.last().unwrap(), "http://localhost:11434/v1/api/tags");
    }

    #[test]
    fn local_source_matching_is_exact() {
        assert!(is_local("local"));
        assert!(!is_local("Local"));
        assert!(!is_local("remote"));
    }

    #[test]
    fn native_chat_url_strips_v1_prefix() {
        assert_eq!(
            native_chat_url("http://localhost:11434/v1/"),
            "http://localhost:11434/api/chat"
        );
        assert_eq!(
            native_chat_url("http://localhost:11434"),
            "http://localhost:11434/api/chat"
        );
    }

    #[test]
    fn ollama_native_only_matches_local_default_port() {
        assert!(is_ollama_native("local", "http://localhost:11434/v1"));
        assert!(is_ollama_native("local", "http://127.0.0.1:11434/v1"));
        assert!(!is_ollama_native("remote", "http://localhost:11434/v1"));
        assert!(!is_ollama_native("local", "http://localhost:8080/v1"));
    }
}
