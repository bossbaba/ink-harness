//! 模型网关领域服务：provider 解析、隐私分级、SSE 流式代理。
//! 不依赖任何 Tauri 类型——流式输出通过回调注入，便于纯 Rust 单测。

use futures_util::StreamExt;

use crate::infrastructure::{db::DbState, keychain, llm_http};
use crate::models::{ChatChunk, ChatParams, ProviderConfig, TokenUsage};
use crate::services::provider;

// ── 核心：流式对话 ────────────────────────────────────────────

/// 发起流式对话，每收到一块就调用 `on_chunk`。
/// `on_chunk` 由调用方（commands 层）注入，service 不关心它落到 Channel 还是别处。
pub async fn stream_chat<F>(
    state: &DbState,
    params: &ChatParams,
    mut on_chunk: F,
) -> Result<Option<TokenUsage>, String>
where
    F: FnMut(ChatChunk),
{
    let resolved = resolve_provider(state, params)?;
    let provider = resolved.provider;
    let api_key = resolved.api_key;

    if params.privacy_local_only && provider.source != "local" {
        return Err("该作品设为仅本地处理，拒绝发送到远端模型".into());
    }

    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    // 注意用 resolved.model（已剥掉 `providerId:` 前缀）：上游只认自己家的模型名，
    // 把路由标识整串发过去，Ollama 会直接回 400 invalid model name。
    let mut body = serde_json::json!({
        "model": resolved.model,
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

    // SSE 解析委托给纯函数组件，便于单测；用量可能在 [DONE] 之前的某块到达。
    let mut parser = SseParser::new();
    let mut usage: Option<TokenUsage> = None;
    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("读取流失败：{}", e))?;
        let events = parser.push(&String::from_utf8_lossy(&bytes));
        for event in events {
            match event {
                SseEvent::Done => {
                    on_chunk(ChatChunk::done());
                    return Ok(usage);
                }
                SseEvent::Delta(text) => on_chunk(ChatChunk::delta(text)),
                SseEvent::Usage(found) => usage = Some(found),
            }
        }
    }

    on_chunk(ChatChunk::done());
    Ok(usage)
}

/// 一次对话实际要打到哪个 Provider、用哪个模型名。
struct ResolvedProvider {
    provider: ProviderConfig,
    api_key: Option<String>,
    /// 真正发给上游的模型名（已去掉 `providerId:` 前缀）。
    model: String,
}

fn resolve_provider(state: &DbState, params: &ChatParams) -> Result<ResolvedProvider, String> {
    let providers = provider::list(state)?;
    let (provider, model) = locate_provider(&providers, &params.model).ok_or_else(|| {
        format!(
            "未找到模型 {} 对应的 Provider，请先在模型管理中配置",
            params.model
        )
    })?;

    let api_key = provider
        .api_key_ref
        .as_ref()
        .and_then(|k| keychain::get(k).ok().flatten());

    Ok(ResolvedProvider {
        provider,
        api_key,
        model,
    })
}

/// 把路由用的模型标识拆成 (providerId, modelId)。
///
/// 模型名自己也可能带冒号（Ollama 的 `qwen2.5:7b`），所以只按**第一个**冒号切一次，
/// 剩下的整体当模型名；没有冒号或切出空串时视为「只有模型名」。
pub fn split_model_ref(reference: &str) -> (Option<&str>, &str) {
    match reference.split_once(':') {
        Some((provider_id, model_id)) if !provider_id.is_empty() && !model_id.is_empty() => {
            (Some(provider_id), model_id)
        }
        _ => (None, reference),
    }
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
    let count = |openai: &str, ollama: &str| -> u32 {
        usage
            .and_then(|item| item.get(openai))
            .or_else(|| value.get(ollama))
            .and_then(|item| item.as_u64())
            .unwrap_or(0) as u32
    };
    let prompt = count("prompt_tokens", "prompt_eval_count");
    let completion = count("completion_tokens", "eval_count");
    if prompt == 0 && completion == 0 {
        return None;
    }
    let total = usage
        .and_then(|item| item.get("total_tokens"))
        .and_then(|item| item.as_u64())
        .unwrap_or((prompt + completion) as u64) as u32;
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
}
