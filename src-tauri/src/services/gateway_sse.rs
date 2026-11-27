//! OpenAI 兼容端点的 SSE 解析（纯逻辑，不依赖 Tauri）：`data:` 帧 → 统一事件。
//!
//! 从 gateway.rs 拆出以控制单文件规模；与 JSON Lines 方言（`gateway_jsonl.rs`）共用
//! `gateway_stream.rs` 里的事件类型与 JSON 取值helpers。

use crate::models::ToolCallChunk;

use super::gateway_stream::{extract_usage, text_of, SseEvent};

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

/// 从 OpenAI 兼容的 SSE 帧里抠出正文。
///
/// 思考型模型（qwen3 / deepseek-r1 / 本地量化的思考模型）在部分端子上把全部输出放进
/// `delta.reasoning` / `delta.reasoning_content`，`delta.content` 恒为空。Ollama 原生已用
/// `think:false` 规避，但 llama.cpp / LM Studio 等本地兼容端点没有这个开关——只读 content
/// 会表现为「发送后完全没有反应」。任一帧里两者都出现时优先 content，避免把思考过程当答案。
///
/// 没有 `delta` 字段的帧才去看整条 `message` 或老式 `text`：后两者是「整段快照」，
/// 与增量帧同时出现会把同一段话输出两遍。
fn extract_delta(data: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let choice = value.get("choices")?.get(0)?;
    if let Some(delta) = choice.get("delta") {
        for key in ["content", "reasoning", "reasoning_content"] {
            if let Some(text) = delta.get(key).and_then(text_of) {
                return Some(text);
            }
        }
        return None;
    }
    if let Some(message) = choice.get("message") {
        for key in ["content", "reasoning", "reasoning_content"] {
            if let Some(text) = message.get(key).and_then(text_of) {
                return Some(text);
            }
        }
    }
    choice.get("text").and_then(text_of)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn delta_event(text: &str) -> String {
        format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{}\"}},\"index\":0}}]}}\n\n",
            text
        )
    }

    /// 本地思考型模型把正文放在 reasoning 字段时也要出字，否则界面看起来「没反应」。
    #[test]
    fn sse_parser_falls_back_to_reasoning_content() {
        let mut parser = SseParser::new();
        let events = parser
            .push("data: {\"choices\":[{\"delta\":{\"reasoning\":\"正在思考\"},\"index\":0}]}\n\n");
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "正在思考"));

        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"别名也认\"},\"index\":0}]}\n\n",
        );
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "别名也认"));
    }

    /// content 与 reasoning 同时出现时只取 content，不把思考过程混进回答。
    #[test]
    fn sse_parser_prefers_content_over_reasoning() {
        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"思考\",\"content\":\"答案\"},\"index\":0}]}\n\n",
        );
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "答案"));
    }

    /// 部分端点把正文拆成内容块数组（OpenAI 的 content parts），拼起来一样要出字。
    #[test]
    fn sse_parser_reads_content_parts_array() {
        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"前半\"},{\"type\":\"text\",\"text\":\"后半\"}]},\"index\":0}]}\n\n",
        );
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "前半后半"));
    }

    /// 整条 message 形态（没有 delta 字段）也要能取到正文。
    #[test]
    fn sse_parser_reads_message_object_without_delta() {
        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"整段回答\"},\"index\":0}]}\n\n",
        );
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "整段回答"));
    }

    /// 有 delta 字段时不再去看整条 message：那是快照，两处都读会把同一段话输出两遍。
    #[test]
    fn sse_parser_ignores_message_snapshot_when_delta_present() {
        let mut parser = SseParser::new();
        let events = parser.push(
            "data: {\"choices\":[{\"delta\":{\"content\":\"增量\"},\"message\":{\"content\":\"增量\"},\"index\":0}]}\n\n",
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SseEvent::Delta(text) if text == "增量"));
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
        assert!(
            matches!(&events[0], SseEvent::ToolCall(c) if c.name == "get_project" && c.index == 0)
        );
        assert!(
            matches!(&events[1], SseEvent::ToolCall(c) if c.name == "list_elements" && c.index == 1)
        );
    }
}
