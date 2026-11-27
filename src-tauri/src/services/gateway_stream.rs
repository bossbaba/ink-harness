//! 流式响应解析的公共部件（纯逻辑，不依赖 Tauri）：统一事件类型与两种方言共用的 JSON 取值。
//!
//! OpenAI 兼容端点走 SSE（`data:` 帧，见 `gateway_sse.rs`），Ollama 原生 `/api/chat`
//! 走 JSON Lines（见 `gateway_jsonl.rs`）。两个解析器都把结果归一成 [`SseEvent`]，
//! 让 `gateway::stream_chat` 不必按方言分支。

use crate::models::{TokenUsage, ToolCallChunk};

/// 一次解析得到的事件：正文增量、工具调用片段、token 用量、流结束。
pub enum SseEvent {
    Delta(String),
    /// 模型决定调用工具时给出的片段；一条响应可能有多片，由前端按 index 拼成完整调用。
    ToolCall(ToolCallChunk),
    /// 上游在流末尾附带的 token 用量，OpenAI 风格 usage 与 Ollama 风格计数字段都认。
    Usage(TokenUsage),
    Done,
}

/// 从一个 JSON 节点里取文本。
///
/// 同一段正文在不同端子上有三种形态：字符串、字符串数组、以及带 `text` 字段的内容块数组
/// （OpenAI 的多模态 content parts）。只认字符串的话，这些端点会被当成「什么都没返回」。
pub(super) fn text_of(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            if text.is_empty() {
                None
            } else {
                Some(text.clone())
            }
        }
        serde_json::Value::Array(items) => {
            let mut buffer = String::new();
            for item in items {
                if let Some(text) = item.as_str() {
                    buffer.push_str(text);
                } else if let Some(text) = item.get("text").and_then(serde_json::Value::as_str) {
                    buffer.push_str(text);
                }
            }
            if buffer.is_empty() {
                None
            } else {
                Some(buffer)
            }
        }
        _ => None,
    }
}

/// 兼容两种上游：OpenAI 的 `usage:{prompt_tokens,...}` 与 Ollama 原生风格的计数字段。
/// 两者都是 0 时视为没有用量，避免把「没给」误记成一次零消耗调用。
pub(super) fn extract_usage(data: &str) -> Option<TokenUsage> {
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let usage = value.get("usage");
    // 上游计数字段不可信：超出 u32 的值直接丢弃，避免 as 截断或加法溢出 panic。
    let count = |openai: &str, ollama: &str| -> u32 {
        usage
            .and_then(|item| item.get(openai))
            .or_else(|| value.get(ollama))
            .and_then(|item| item.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(0)
    };
    let prompt = count("prompt_tokens", "prompt_eval_count");
    let completion = count("completion_tokens", "eval_count");
    if prompt == 0 && completion == 0 {
        return None;
    }
    let total = usage
        .and_then(|item| item.get("total_tokens"))
        .and_then(|item| item.as_u64())
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or_else(|| prompt.saturating_add(completion));
    Some(TokenUsage {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
    })
}
