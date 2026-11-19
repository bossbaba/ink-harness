//! 网关的流式响应解析（纯逻辑，不依赖 Tauri）：把上游字节片段增量解析成统一事件。
//!
//! OpenAI 兼容端点走 SSE（`data:` 帧），Ollama 原生 `/api/chat` 走 JSON Lines；
//! 两种方言都归一成 [`SseEvent`]，让 `gateway::stream_chat` 不必按方言分支。
//! 从 gateway.rs 拆出以控制单文件规模，解析规则与单测一并迁移，便于独立回归。

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
                    continue;
                }
                // 三类事件互不排斥：工具调用帧通常 content 为空，但用量可能和工具帧同一帧到达。
                if let Some(token_usage) = extract_usage(data) {
                    events.push(SseEvent::Usage(token_usage));
                }
                if let Some(delta) = extract_delta(data) {
                    if !delta.is_empty() {
                        events.push(SseEvent::Delta(delta));
                    }
                }
                events.extend(extract_tool_calls(data).into_iter().map(SseEvent::ToolCall));
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
            // Ollama 原生把工具调用放在 message.tool_calls，arguments 已经是对象而非字符串。
            if let Some(message) = value.get("message") {
                events.extend(
                    extract_native_tool_calls(message)
                        .into_iter()
                        .map(SseEvent::ToolCall),
                );
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

/// 从 OpenAI 兼容的 SSE 帧里抠出 `choices[0].delta.tool_calls`。
///
/// 每帧可能带多个工具（不同 index），arguments 是增量字符串；id/name 只在首帧出现。
/// 解析失败一律当作没有工具调用，避免一帧脏数据打断整条正文流。
fn extract_tool_calls(data: &str) -> Vec<ToolCallChunk> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return Vec::new();
    };
    let Some(calls) = value
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("tool_calls"))
        .and_then(|t| t.as_array())
    else {
        return Vec::new();
    };
    calls
        .iter()
        .filter_map(|call| {
            let index = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
            let function = call.get("function")?;
            Some(ToolCallChunk {
                index,
                id: call
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or_default()
                    .to_string(),
                name: function
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string(),
                arguments: function
                    .get("arguments")
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .to_string(),
            })
        })
        .collect()
}

/// 从 Ollama 原生 `message.tool_calls` 抠出工具调用。
///
/// 原生接口的 arguments 已经是对象（不是增量字符串），这里序列化成 JSON 文本，
/// 让前端复用与 OpenAI 相同的拼接/解析逻辑；id 缺失时用「工具名+序号」兜底。
fn extract_native_tool_calls(message: &serde_json::Value) -> Vec<ToolCallChunk> {
    let Some(calls) = message
        .get("tool_calls")
        .and_then(|t| t.as_array())
    else {
        return Vec::new();
    };
    calls
        .iter()
        .enumerate()
        .filter_map(|(index, call)| {
            let function = call.get("function")?;
            let name = function
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string();
            let arguments = function
                .get("arguments")
                .map(|a| {
                    // 字符串直接用，对象/数组则序列化；拿不到就给空对象，前端解析不会失败。
                    if let Some(s) = a.as_str() {
                        s.to_string()
                    } else {
                        a.to_string()
                    }
                })
                .unwrap_or_else(|| "{}".to_string());
            let id = call
                .get("id")
                .and_then(|i| i.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{name}-{index}"));
            Some(ToolCallChunk {
                index,
                id,
                name,
                arguments,
            })
        })
        .collect()
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

    #[test]
    fn sse_parser_emits_tool_call_across_fragments() {
        let mut parser = SseParser::new();
        // 首帧带 id/name 与半截 arguments，次帧只补 arguments 尾部。
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"read_chapter\",\"arguments\":\"{\\\"id\\\":\"}}]}}]}\n\n",
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            SseEvent::ToolCall(call) => {
                assert_eq!(call.index, 0);
                assert_eq!(call.id, "call_1");
                assert_eq!(call.name, "read_chapter");
                assert_eq!(call.arguments, "{\"id\":");
            }
            _ => panic!("expected tool call"),
        }
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"c1\\\"}\"}}]}}]}\n\n",
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            SseEvent::ToolCall(call) => {
                assert_eq!(call.id, "");
                assert_eq!(call.arguments, "\"c1\"}");
            }
            _ => panic!("expected tool call"),
        }
    }

    #[test]
    fn sse_parser_emits_multiple_tool_calls_in_one_frame() {
        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"get_project\",\"arguments\":\"{}\"}},{\"index\":1,\"id\":\"b\",\"function\":{\"name\":\"list_elements\",\"arguments\":\"{}\"}}]}}]}\n\n",
        );
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], SseEvent::ToolCall(c) if c.name == "get_project" && c.index == 0));
        assert!(matches!(&events[1], SseEvent::ToolCall(c) if c.name == "list_elements" && c.index == 1));
    }

    #[test]
    fn jsonl_parser_emits_native_tool_call() {
        let mut parser = JsonlParser::new();
        let events = parser.push(
            "{\"message\":{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"function\":{\"name\":\"read_chapter\",\"arguments\":{\"id\":\"c1\"}}}]},\"done\":true}\n",
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            SseEvent::ToolCall(call) => {
                assert_eq!(call.name, "read_chapter");
                assert_eq!(call.id, "read_chapter-0");
                assert_eq!(call.arguments, "{\"id\":\"c1\"}");
            }
            _ => panic!("expected native tool call"),
        }
    }
}
