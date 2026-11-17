//! 模型网关领域服务：provider 解析、隐私分级、SSE 流式代理。
//! 不依赖任何 Tauri 类型——流式输出通过回调注入，便于纯 Rust 单测。

use futures_util::StreamExt;

use crate::infrastructure::{db::DbState, keychain, llm_http};
use crate::models::{ChatChunk, ChatParams, ProviderConfig};
use crate::services::provider;

// ── 核心：流式对话 ────────────────────────────────────────────

/// 发起流式对话，每收到一块就调用 `on_chunk`。
/// `on_chunk` 由调用方（commands 层）注入，service 不关心它落到 Channel 还是别处。
pub async fn stream_chat<F>(
    state: &DbState,
    params: &ChatParams,
    mut on_chunk: F,
) -> Result<(), String>
where
    F: FnMut(ChatChunk),
{
    let (provider, api_key) = resolve_provider(state, params)?;

    if params.privacy_local_only && provider.source != "local" {
        return Err("该作品设为仅本地处理，拒绝发送到远端模型".into());
    }

    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    let mut body = serde_json::json!({
        "model": params.model,
        "messages": params.messages,
        "stream": true,
    });
    if let Some(t) = params.temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = params.max_tokens {
        body["max_tokens"] = serde_json::json!(m);
    }

    let mut req = llm_http::client().post(&url).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("请求模型失败：{}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("模型返回错误 {status}：{}", truncate(&text, 500)));
    }

    // SSE 解析委托给纯函数组件，便于单测
    let mut parser = SseParser::new();
    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("读取流失败：{}", e))?;
        let events = parser.push(&String::from_utf8_lossy(&bytes));
        for event in events {
            match event {
                SseEvent::Done => {
                    on_chunk(ChatChunk::done());
                    return Ok(());
                }
                SseEvent::Delta(text) => on_chunk(ChatChunk::delta(text)),
            }
        }
    }

    on_chunk(ChatChunk::done());
    Ok(())
}

fn resolve_provider(
    state: &DbState,
    params: &ChatParams,
) -> Result<(ProviderConfig, Option<String>), String> {
    let providers = provider::list(state)?;

    // 约定模型标识为 `providerId:modelId`；兼容旧调用（只有模型名）时退到第一个可用 Provider。
    let provider = params
        .model
        .split_once(':')
        .and_then(|(provider_id, _)| providers.iter().find(|p| p.id == provider_id).cloned())
        .or_else(|| {
            providers
                .iter()
                .find(|p| p.enabled && params.model.starts_with(&p.id))
                .cloned()
        })
        .or_else(|| {
            providers
                .iter()
                .find(|p| p.enabled && p.source == "local")
                .cloned()
        })
        .or_else(|| providers.iter().find(|p| p.enabled).cloned())
        .ok_or_else(|| {
            format!(
                "未找到模型 {} 对应的 Provider，请先在模型管理中配置",
                params.model
            )
        })?;

    let api_key = provider
        .api_key_ref
        .as_ref()
        .and_then(|k| keychain::get(k).ok().flatten());

    Ok((provider, api_key))
}

// ── SSE 解析（纯逻辑，可单测） ─────────────────────────────────

pub enum SseEvent {
    Delta(String),
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

fn truncate(s: &str, max: usize) -> &str {
    if s.chars().count() <= max {
        s
    } else {
        let end = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
        &s[..end]
    }
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
}
