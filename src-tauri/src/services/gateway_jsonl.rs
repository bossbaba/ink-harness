//! Ollama 原生 `/api/chat` 的 JSON Lines 解析（纯逻辑，不依赖 Tauri）：每行一个 JSON → 统一事件。
//!
//! 与 SSE 方言（`gateway_sse.rs`）共用 `gateway_stream.rs` 里的事件类型与 JSON 取值helpers。

use crate::models::ToolCallChunk;

use super::gateway_stream::{SseEvent, extract_usage, text_of};

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
            // 正文优先取 content；思考型模型把内容放进 thinking / reasoning 时也要出字，
            // 否则整条流只剩工具调用，界面看起来像「模型没反应」。
            if let Some(message) = value.get("message") {
                for key in ["content", "thinking", "reasoning", "reasoning_content"] {
                    if let Some(text) = message.get(key).and_then(text_of) {
                        events.push(SseEvent::Delta(text));
                        break;
                    }
                }
                // Ollama 原生把工具调用放在 message.tool_calls，arguments 已经是对象而非字符串。
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

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Ollama 原生把思考内容放在 message.thinking，同样要出字。
    #[test]
    fn jsonl_parser_falls_back_to_thinking_field() {
        let mut parser = JsonlParser::new();
        let events = parser.push("{\"message\":{\"thinking\":\"先想一下\",\"content\":\"\"}}\n");
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "先想一下"));
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
