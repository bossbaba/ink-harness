//! 模型网关领域服务：流式对话编排。
//! 不依赖任何 Tauri 类型——流式输出通过回调注入，便于纯 Rust 单测。
//!
//! 纯解析逻辑已拆到同目录的 `gateway_sse.rs`（SSE/JSONL）与 `gateway_resolve.rs`
//! （Provider 解析），本文件只保留「解析 → 隐私校验 → 重试 → 读流 → 回调」的编排主链路，
//! 以控制单文件规模；那些模块各自的单测随代码一起迁移。

use std::time::Duration;

use futures_util::StreamExt;
use tokio::time::timeout;

use crate::error::AppError;
use crate::infrastructure::{db::DbState, llm_http};
use crate::models::{ChatChunk, ChatParams, TokenUsage};
use crate::services::{project, provider_kind};

use super::gateway_resolve::{ResolvedProvider, resolve_provider};
use super::gateway_sse::{JsonlParser, ResponseParser, SseEvent, SseParser};

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
    let resolved: ResolvedProvider = resolve_provider(state, params)?;
    let api_key = resolved.api_key;

    // 隐私分级以库里作品的 privacy 为准，前端声明只能收紧张不能放宽：
    // 传了 project_id 就必须受作品设置约束，避免改一个 IPC 参数就把仅本地作品发往云端。
    let local_only = match params.project_id.as_deref() {
        Some(project_id) => project::is_local_only(state, project_id)? || params.privacy_local_only,
        // 没有作品上下文（工作台级请求）时只能采信调用方声明，这是已知的次要缺口。
        None => params.privacy_local_only,
    };
    if local_only && !provider_kind::is_local(&resolved.provider.source) {
        return Err(AppError::validation(
            "该作品设为仅本地处理，拒绝发送到远端模型",
        ));
    }

    // 本地 Ollama 的思考型模型（qwen3.5 / deepseek-r1 等）在 OpenAI 兼容端点上会把全部输出
    // 放进 `delta.reasoning`，`delta.content` 始终为空，前端就会报「模型没有返回内容」。
    // 原生 /api/chat 支持 think:false，能稳定拿到正文；其他 Provider 仍走通用 SSE。
    let native_ollama =
        provider_kind::is_ollama_native(&resolved.provider.source, &resolved.provider.base_url);
    let url = if native_ollama {
        provider_kind::native_chat_url(&resolved.provider.base_url)
    } else {
        provider_kind::chat_url(&resolved.provider.base_url)
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
    // 工具定义非空时才带 tools：空数组发给 Ollama 原生接口可能被当成一次无效工具请求。
    if !params.tools.is_empty() {
        body["tools"] = serde_json::json!(params.tools);
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
                SseEvent::ToolCall(call) => {
                    if !on_chunk(ChatChunk::tool_call(call)) {
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
                tool_call_id: None,
                name: None,
                tool_calls: None,
            }],
            temperature: None,
            max_tokens: None,
            privacy_local_only: false,
            task_kind: None,
            project_id: None,
            tools: Vec::new(),
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
