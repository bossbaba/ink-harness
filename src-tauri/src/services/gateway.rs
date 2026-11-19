//! 模型网关领域服务：provider 解析、隐私分级、SSE 流式代理。
//! 不依赖任何 Tauri 类型——流式输出通过回调注入，便于纯 Rust 单测。

use std::time::Duration;

use futures_util::StreamExt;
use tokio::time::timeout;

use crate::error::AppError;
use crate::infrastructure::{db::DbState, keychain, llm_http};
use crate::models::{split_model_ref, ChatChunk, ChatParams, ProviderConfig, TokenUsage};
use crate::services::{project, provider, provider_kind};

// ── 核心：流式对话 ────────────────────────────────────────────

/// 发起流式对话，每收到一块就调用 `on_chunk`。
/// `on_chunk` 由调用方（commands 层）注入，返回 false 表示接收端已断开，应立刻停止读取。
pub async fn stream_chat<F>(
    state: &DbState,
    params: &ChatParams,
    mut on_chunk: F,
) -> Result<Option<TokenUsage>, AppError>
where
    F: FnMut(ChatChunk) -> bool,
{
    let resolved = resolve_provider(state, params)?;
    let provider = resolved.provider;
    let api_key = resolved.api_key;

    // 隐私分级以库里作品的 privacy 为准，前端声明只能收紧张不能放宽：
    // 传了 project_id 就必须受作品设置约束，避免改一个 IPC 参数就把仅本地作品发往云端。
    let local_only = match params.project_id.as_deref() {
        Some(project_id) => {
            project::is_local_only(state, project_id)? || params.privacy_local_only
        }
        // 没有作品上下文（工作台级请求）时只能采信调用方声明，这是已知的次要缺口。
        None => params.privacy_local_only,
    };
    if local_only && !provider_kind::is_local(&provider.source) {
        return Err(AppError::validation(
            "该作品设为仅本地处理，拒绝发送到远端模型",
        ));
    }

    // 本地 Ollama 的思考型模型（qwen3.5 / deepseek-r1 等）在 OpenAI 兼容端点上会把全部输出
    // 放进 `delta.reasoning`，`delta.content` 始终为空，前端就会报「模型没有返回内容」。
    // 原生 /api/chat 支持 think:false，能稳定拿到正文；其他 Provider 仍走通用 SSE。
    let native_ollama = provider_kind::is_ollama_native(&provider.source, &provider.base_url);
    let url = if native_ollama {
        provider_kind::native_chat_url(&provider.base_url)
    } else {
        provider_kind::chat_url(&provider.base_url)
    };
    // 注意用 resolved.model（已剥掉 `providerId:` 前缀）：上游只认自己家的模型名，
    // 把路由标识整串发过去，Ollama 会直接回 400 invalid model name。
    let mut body = serde_json::json!({
        "model": resolved.model,
        "messages": params.messages,
        "stream": true,
    });
    if native_ollama {
        body["think"] = serde_json::json!(false);
    }
    // NaN/Infinity 会被序列化成 null 导致上游 400，非有限值和无效 token 上限就地丢弃。
    if let Some(t) = params.temperature.filter(|t| t.is_finite()) {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = params.max_tokens.filter(|m| *m > 0) {
        body["max_tokens"] = serde_json::json!(m);
    }

    // 只在「还没收到任何流式数据」时重试：一旦开始出字再重试，
    // 会把前后两次生成的半截内容拼在一起，比直接报错更糟。
    let client = llm_http::client();
    let mut attempt = 0u32;
    let response = loop {
        let mut req = client.post(&url).json(&body);
        if let Some(key) = api_key.as_deref() {
            req = req.bearer_auth(key);
        }
        match req.send().await {
            Ok(response) if response.status().is_success() => break response,
            Ok(response) => {
                let status = response.status();
                let retryable = llm_http::retryable_status(status);
                let text = response.text().await.unwrap_or_default();
                if retryable && attempt + 1 < llm_http::MAX_ATTEMPTS {
                    eprintln!("模型请求返回 {status}，第 {} 次重试", attempt + 1);
                    tokio::time::sleep(llm_http::backoff(attempt)).await;
                    attempt += 1;
                    continue;
                }
                return Err(AppError::upstream(format!(
                    "模型返回错误 {status}：{}",
                    truncate(&text, 500)
                )));
            }
            Err(err) => {
                if llm_http::retryable_error(&err) && attempt + 1 < llm_http::MAX_ATTEMPTS {
                    eprintln!("模型请求失败（{err}），第 {} 次重试", attempt + 1);
                    tokio::time::sleep(llm_http::backoff(attempt)).await;
                    attempt += 1;
                    continue;
                }
                return Err(AppError::network(format!("请求模型失败：{err}")));
            }
        }
    };

    // 流式解析委托给纯函数组件，便于单测；用量可能在结束帧之前的某块到达。
    let mut parser = if native_ollama {
        ResponseParser::Jsonl(JsonlParser::new())
    } else {
        ResponseParser::Sse(SseParser::new())
    };
    let mut usage: Option<TokenUsage> = None;
    let mut stream = response.bytes_stream();
    loop {
        // 长文本生成允许整体耗时很久，但连续 120 秒收不到任何字节就视为上游假死。
        let next = timeout(Duration::from_secs(120), stream.next())
            .await
            .map_err(|_| AppError::network("模型长时间未返回数据，已中断本次对话"))?;
        let Some(item) = next else { break };
        let bytes = item.map_err(|e| AppError::network(format!("读取流失败：{e}")))?;
        let events = parser.push(&String::from_utf8_lossy(&bytes));
        for event in events {
            match event {
                SseEvent::Done => {
                    return if on_chunk(ChatChunk::done()) {
                        Ok(usage)
                    } else {
                        Err(AppError::internal("对话已被取消"))
                    };
                }
                SseEvent::Delta(text) => {
                    if !on_chunk(ChatChunk::delta(text)) {
                        return Err(AppError::internal("对话已被取消"));
                    }
                }
                SseEvent::Usage(found) => usage = Some(found),
            }
        }
    }

    if on_chunk(ChatChunk::done()) {
        Ok(usage)
    } else {
        Err(AppError::internal("对话已被取消"))
    }
}

/// 一次对话实际要打到哪个 Provider、用哪个模型名。
struct ResolvedProvider {
    provider: ProviderConfig,
    api_key: Option<String>,
    /// 真正发给上游的模型名（已去掉 `providerId:` 前缀）。
    model: String,
}

fn resolve_provider(state: &DbState, params: &ChatParams) -> Result<ResolvedProvider, AppError> {
    let providers = provider::list(state)?;
    let (provider, model) = locate_provider(&providers, &params.model).ok_or_else(|| {
        format!(
            "未找到模型 {} 对应的 Provider，请先在模型管理中配置",
            params.model
        )
    })?;

    let api_key = keychain::optional(provider.api_key_ref.as_deref());

    Ok(ResolvedProvider {
        provider,
        api_key,
        model,
    })
}

/// 按模型标识找到 Provider，并给出真正要发给上游的模型名。
///
/// 正常路径是 `providerId:modelId`；兼容旧调用（只给模型名）时退回「以 provider id 开头 →
/// 本地 Provider → 任意启用 Provider」。前缀写了但 Provider 不存在、整串又不是某个已登记模型名时
/// 直接返回 None：与其把 `typo:model` 当模型名发给上游换回一个莫名 400，不如在界面上说清楚。
fn locate_provider(
    providers: &[ProviderConfig],
    reference: &str,
) -> Option<(ProviderConfig, String)> {
    let (provider_id, model) = split_model_ref(reference);
    if let Some(id) = provider_id {
        if let Some(found) = providers.iter().find(|p| p.id == id) {
            return Some((found.clone(), model.to_string()));
        }
        let is_known_model = providers
            .iter()
            .any(|p| p.models.iter().any(|m| m.id == reference));
        if !is_known_model {
            return None;
        }
    }

    let fallback = providers
        .iter()
        .find(|p| p.enabled && reference.starts_with(&p.id))
        .or_else(|| providers.iter().find(|p| p.enabled && p.source == "local"))
        .or_else(|| providers.iter().find(|p| p.enabled))?;
    Some((fallback.clone(), reference.to_string()))
}

// ── SSE 解析（纯逻辑，可单测） ─────────────────────────────────

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
enum ResponseParser {
    Sse(SseParser),
    Jsonl(JsonlParser),
}

impl ResponseParser {
    fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        match self {
            Self::Sse(parser) => parser.push(chunk),
            Self::Jsonl(parser) => parser.push(chunk),
        }
    }
}

/// Ollama 原生 /api/chat 返回 JSON Lines：每行一个 JSON，正文在 `message.content`。
/// 这里不处理 `done` 帧，交给外层流结束后统一发 done，避免与取消逻辑重复。
struct JsonlParser {
    buffer: String,
}

impl JsonlParser {
    fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
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
    use crate::models::chat::ChatMessage;
    use crate::models::ProviderModel;

    fn provider(id: &str, source: &str, enabled: bool, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: id.to_string(),
            source: source.to_string(),
            base_url: format!("http://{id}/v1"),
            api_key_ref: None,
            enabled,
            models: models
                .iter()
                .map(|m| ProviderModel {
                    id: m.to_string(),
                    display_name: m.to_string(),
                    context_window: 8192,
                    cost_per_1k_tokens: None,
                })
                .collect(),
        }
    }

    #[test]
    fn split_model_ref_keeps_ollama_tag_after_first_colon() {
        // Ollama 的模型名自己带冒号，必须整段保留，否则会拿 `qwen2.5` 去打 tag 为 `qwen2.5:7b` 的模型。
        assert_eq!(
            split_model_ref("ollama-local:qwen2.5:7b"),
            (Some("ollama-local"), "qwen2.5:7b")
        );
        assert_eq!(split_model_ref("gpt-4o"), (None, "gpt-4o"));
        // 空段一律当「没有前缀」，避免把空 provider id 当成有效标识。
        assert_eq!(split_model_ref(":gpt-4o"), (None, ":gpt-4o"));
        assert_eq!(split_model_ref("ollama-local:"), (None, "ollama-local:"));
    }

    #[test]
    fn locate_provider_strips_router_prefix() {
        let providers = vec![provider("ollama-local", "local", true, &["qwen2.5:7b"])];
        let (found, model) = locate_provider(&providers, "ollama-local:qwen2.5:7b").expect("应命中");
        assert_eq!(found.id, "ollama-local");
        assert_eq!(model, "qwen2.5:7b");
    }

    #[test]
    fn locate_provider_accepts_bare_model_name() {
        // 旧调用只给模型名：退到本地 Provider，模型名原样透传。
        let providers = vec![provider("ollama-local", "local", true, &["qwen2.5:7b"])];
        let (found, model) = locate_provider(&providers, "qwen2.5:7b").expect("应命中本地 Provider");
        assert_eq!(found.id, "ollama-local");
        assert_eq!(model, "qwen2.5:7b");
    }

    #[test]
    fn locate_provider_rejects_unknown_prefix() {
        // 前缀写错时不能悄悄回退到本地 Provider，否则上游只会回一个看不懂的 400。
        let providers = vec![provider("ollama-local", "local", true, &["qwen2.5:7b"])];
        assert!(locate_provider(&providers, "olama-local:qwen2.5:7b").is_none());
    }

    #[test]
    fn locate_provider_skips_disabled_when_falling_back() {
        let providers = vec![
            provider("remote-a", "remote", false, &["gpt-4o"]),
            provider("local-b", "local", true, &["qwen2.5:7b"]),
        ];
        let (found, _) = locate_provider(&providers, "unknown-name").expect("应回退到启用的本地 Provider");
        assert_eq!(found.id, "local-b");
    }

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
        let events = parser.push("data: {\"prompt_eval_count\":7,\"eval_count\":9,\"done\":true}\n\n");
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

    #[tokio::test]
    #[ignore = "需要本机运行 Ollama 并已拉取 qwen3.5:4b"]
    async fn manual_native_ollama_returns_content() {
        let dir = std::env::temp_dir().join(format!("ink-gateway-test-{}", std::process::id()));
        let state = crate::infrastructure::db::open(&dir).expect("open temp db");
        let mut content = String::new();
        let params = ChatParams {
            model: "ollama-local:qwen3.5:4b".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "用一句话回答：1+1等于几？".to_string(),
            }],
            temperature: None,
            max_tokens: None,
            privacy_local_only: false,
            task_kind: None,
            project_id: None,
        };
        let usage = stream_chat(&state, &params, |chunk| {
            content.push_str(&chunk.delta);
            true
        })
        .await
        .expect("stream");
        assert!(!content.trim().is_empty(), "原生接口应返回正文");
        println!("content={content}, usage={usage:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
