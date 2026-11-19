//! 网关的流式响应解析（纯逻辑，不依赖 Tauri）：把上游字节片段增量解析成统一事件。
//!
//! OpenAI 兼容端点走 SSE（`data:` 帧），Ollama 原生 `/api/chat` 走 JSON Lines；
//! 两种方言都归一成 [`SseEvent`]，让 `gateway::stream_chat` 不必按方言分支。
//! 从 gateway.rs 拆出以控制单文件规模，解析规则与单测一并迁移，便于独立回归。

use crate::models::TokenUsage;

/// 一次解析得到的事件：正文增量、token 用量、流结束。
pub enum SseEvent {
    Delta(String),
    /// 上游在流末尾附带的 token 用量，OpenAI 风格 usage 与 Ollama 风格计数字段都认。
    Usage(TokenUsage),
    Done,
}

/// 增量 SSE 解析器：持有一块未完成缓冲，喂入字节片段返回已完成的事件。
pub struct SseParser {
    buffer: String,
}

impl SseParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();

        while let Some(pos) = self.buffer.find("\n\n") {
            let raw: String = self.buffer.drain(..pos + 2).collect();
            for line in raw.lines() {
                let Some(data) = line.trim().strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    events.push(SseEvent::Done);
                } else if let Some(token_usage) = extract_usage(data) {
                    events.push(SseEvent::Usage(token_usage));
                } else if let Some(delta) = extract_delta(data) {
                    if !delta.is_empty() {
                        events.push(SseEvent::Delta(delta));
                    }
                }
            }
        }
        events
    }
}

impl Default for SseParser {
    fn default() -> Self {
        Self::new()
    }
}

/// 两种上游响应格式共用同一套事件，调用方不需要按方言分支。
pub enum ResponseParser {
    Sse(SseParser),
    Jsonl(JsonlParser),
}

impl ResponseParser {
    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        match self {
            Self::Sse(parser) => parser.push(chunk),
            Self::Jsonl(parser) => parser.push(chunk),
        }
    }
}

/// Ollama 原生 /api/chat 返回 JSON Lines：每行一个 JSON，正文在 `message.content`。
/// 这里不处理 `done` 帧，交给外层流结束后统一发 done，避免与取消逻辑重复。
pub struct JsonlParser {
    buffer: String,
}

impl JsonlParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();
        while let Some(pos) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..pos + 1).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            if let Some(content) = value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
            {
                if !content.is_empty() {
                    events.push(SseEvent::Delta(content.to_string()));
                }
            }
            if let Some(usage) = extract_usage(line) {
                events.push(SseEvent::Usage(usage));
            }
        }
        events
    }
}

fn extract_delta(data: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    value
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(|s| s.to_string())
}

/// 兼容两种上游：OpenAI 的 `usage:{prompt_tokens,...}` 与 Ollama 原生风格的计数字段。
/// 两者都是 0 时视为没有用量，避免把「没给」误记成一次零消耗调用。
fn extract_usage(data: &str) -> Option<TokenUsage> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn delta_event(text: &str) -> String {
        format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{}\"}},\"index\":0}}]}}\n\n",
            text
        )
    }

    #[test]
    fn sse_parser_emits_delta() {
        let mut parser = SseParser::new();
        let events = parser.push(&delta_event("你好"));
        assert_eq!(events.len(), 1);
        match &events[0] {
            SseEvent::Delta(text) => assert_eq!(text, "你好"),
            _ => panic!("expected delta"),
        }
    }

    #[test]
    fn sse_parser_handles_split_chunks() {
        let mut parser = SseParser::new();
        let raw = delta_event("世界");
        let (a, b) = raw.split_at(20);
        assert!(parser.push(a).is_empty(), "incomplete event yields nothing");
        let events = parser.push(b);
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn sse_parser_emits_done() {
        let mut parser = SseParser::new();
        let events = parser.push("data: [DONE]\n\n");
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], SseEvent::Done));
    }

    #[test]
    fn sse_parser_ignores_role_only_chunks() {
        let mut parser = SseParser::new();
        let events = parser.push("data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n");
        assert!(events.is_empty());
    }

    #[test]
    fn sse_parser_buffers_incomplete_data() {
        let mut parser = SseParser::new();
        assert!(parser.push("data: {\"choices\":").is_empty());
    }

    #[test]
    fn sse_parser_extracts_openai_usage() {
        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":34,\"total_tokens\":46}}\n\n",
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            SseEvent::Usage(usage) => {
                assert_eq!(usage.prompt_tokens, 12);
                assert_eq!(usage.completion_tokens, 34);
                assert_eq!(usage.total_tokens, 46);
            }
            _ => panic!("expected usage"),
        }
    }

    #[test]
    fn sse_parser_extracts_ollama_style_usage() {
        let mut parser = SseParser::new();
        let events =
            parser.push("data: {\"prompt_eval_count\":7,\"eval_count\":9,\"done\":true}\n\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            SseEvent::Usage(usage) => assert_eq!(usage.total_tokens, 16),
            _ => panic!("expected usage"),
        }
    }

    #[test]
    fn jsonl_parser_emits_message_content_and_usage() {
        let mut parser = JsonlParser::new();
        let events = parser
            .push("{\"message\":{\"role\":\"assistant\",\"content\":\"你好\"},\"done\":false}\n");
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "你好"));

        let events = parser.push(
            "{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"prompt_eval_count\":7,\"eval_count\":9}\n",
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SseEvent::Usage(usage) if usage.total_tokens == 16));
    }

    #[test]
    fn jsonl_parser_buffers_incomplete_line() {
        let mut parser = JsonlParser::new();
        assert!(parser.push("{\"message\":{\"content\":\"你").is_empty());
        let events = parser.push("好\"}}\n");
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "你好"));
    }
}
