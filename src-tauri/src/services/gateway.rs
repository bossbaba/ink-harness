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
use crate::models::chat::ChatMessage;
use crate::models::{ChatChunk, ChatParams, TokenUsage};
use crate::services::{cancel::CancelFlag, guardrails, project, provider_kind};

use super::gateway_resolve::{ResolvedProvider, resolve_provider};
use super::gateway_sse::{JsonlParser, ResponseParser, SseEvent, SseParser};

/// 发起流式对话，每收到一块就调用 `on_chunk`。
/// `on_chunk` 由调用方（commands 层）注入，返回 false 表示接收端已断开，应立刻停止读取。
///
/// 只在收到 chunk 时检查取消是不够的：模型「正在思考、迟迟不出第一个字」时点停止，
/// 旧实现要等到 120s 空闲超时才退出，期间连接和 token 都还在烧。
/// 所以额外在重试等待与读流等待处检查 `cancel`；没有 requestId 的老调用方传 None。
pub async fn stream_chat_with_cancel<F>(
    state: &DbState,
    params: &ChatParams,
    mut on_chunk: F,
    cancel: Option<&CancelFlag>,
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
    // 原生接口对多轮工具消息的 arguments 类型要求不同，必须按方言转换后再发。
    let messages = if native_ollama {
        native_messages(&params.messages)
    } else {
        serde_json::to_value(&params.messages)
            .unwrap_or(serde_json::Value::Array(Vec::new()))
            .as_array()
            .cloned()
            .unwrap_or_default()
    };

    let mut body = serde_json::json!({
        "model": resolved.model,
        "messages": messages,
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
        // tool_choice 只在有工具时才有意义：没有 tools 却要求 required，上游会直接 400。
        if let Some(choice) = params.tool_choice.as_deref() {
            body["tool_choice"] = serde_json::json!(choice);
        }
    }

    // 只在「还没收到任何流式数据」时重试：一旦开始出字再重试，
    // 会把前后两次生成的半截内容拼在一起，比直接报错更糟。
    let client = llm_http::client();
    let mut attempt = 0u32;
    let response = loop {
        // 可能在重试退避里被取消：下一次发请求前先看标志，别再打一发。
        if cancel.map_or(false, |flag| flag.is_cancelled()) {
            return Err(AppError::internal("对话已被取消"));
        }
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
        // 同时每 200ms 看一眼取消标志：等首字的阶段也能被「停止」立刻打断，
        // 不引入 tokio-util 的 CancellationToken——这里只需要一个布尔量。
        let next = tokio::select! {
            _ = async {
                loop {
                    if cancel.map_or(false, |flag| flag.is_cancelled()) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            } => return Err(AppError::internal("对话已被取消")),
            value = timeout(Duration::from_secs(120), stream.next()) => value
                .map_err(|_| AppError::network("模型长时间未返回数据，已中断本次对话"))?,
        };
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
                    // 输出脱敏：模型可能被提示词注入带去吐凭据，逐块屏蔽后再推给前端。
                    // 完整输出的边界情况由 chat.rs 落库前的二次 scrub 兜住。
                    let text = guardrails::scrub_chunk(&text);
                    if !on_chunk(ChatChunk::delta(text)) {
                        return Err(AppError::internal("对话已被取消"));
                    }
                }
                SseEvent::ToolCall(call) => {
                    if !on_chunk(ChatChunk::tool_call(call)) {
                        return Err(AppError::internal("对话已被取消"));
                    }
                }
                SseEvent::Usage(found) => {
                    // 用量除记进返回值（供 agent_run 落库）外，还要作为独立块推给前端：
                    // 轨迹里的每步 tokens 靠它记账，只写 agent_run 的话看板聚合没有数据源。
                    usage = Some(found.clone());
                    if !on_chunk(ChatChunk::usage(found)) {
                        return Err(AppError::internal("对话已被取消"));
                    }
                }
            }
        }
    }

    if on_chunk(ChatChunk::done()) {
        Ok(usage)
    } else {
        Err(AppError::internal("对话已被取消"))
    }
}

/// 把消息转成 Ollama 原生 `/api/chat` 能接受的形状。
///
/// 前端为了兼容 OpenAI，把 `assistant.tool_calls[].function.arguments` 传成 JSON **字符串**；
/// 原生接口只认对象，收到字符串会直接 400（`Value looks like object, but can't find
/// closing '}' symbol`），于是「工具调用 → 回填结果 → 再问一轮」的第二轮必挂。
/// 这里解析成对象；解析不出来就给空对象——参数本来就坏了，不该让整轮对话失败。
fn native_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|message| {
            let mut value = serde_json::to_value(message).unwrap_or(serde_json::Value::Null);
            let Some(calls) = value.get_mut("toolCalls").and_then(|item| item.as_array_mut()) else {
                return value;
            };
            for call in calls {
                let Some(args) = call.pointer_mut("/function/arguments") else {
                    continue;
                };
                if let Some(text) = args.as_str() {
                    *args = serde_json::from_str(text).unwrap_or_else(|_| serde_json::json!({}));
                }
            }
            value
        })
        .collect()
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

    /// 原生接口要的是 arguments 对象；字符串原样发过去会被 400 拒掉，多轮工具调用根本走不完。
    #[test]
    fn native_messages_turn_tool_arguments_into_objects() {
        let messages = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_call_id: None,
                name: None,
                tool_calls: Some(serde_json::json!([{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "read_chapter", "arguments": "{\"withContent\":true}" }
                }])),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: "{\"title\":\"第一章\"}".to_string(),
                tool_call_id: Some("call_1".to_string()),
                name: Some("read_chapter".to_string()),
                tool_calls: None,
            },
        ];

        let converted = native_messages(&messages);
        assert_eq!(
            converted[0].pointer("/toolCalls/0/function/arguments"),
            Some(&serde_json::json!({ "withContent": true }))
        );
        // 工具结果消息保持原样：原生接口同样接受 toolCallId/name 字段。
        assert_eq!(converted[1]["role"], serde_json::json!("tool"));
        assert_eq!(converted[1]["name"], serde_json::json!("read_chapter"));
    }

    /// 参数是被截断或乱码时不能把整轮请求打成 400，退化成空对象让对话继续。
    #[test]
    fn native_messages_fall_back_to_empty_object_on_bad_arguments() {
        let messages = vec![ChatMessage {
            role: "assistant".to_string(),
            content: String::new(),
            tool_call_id: None,
            name: None,
            tool_calls: Some(serde_json::json!([{
                "function": { "name": "read_chapter", "arguments": "{\"withContent\":" }
            }])),
        }];

        let converted = native_messages(&messages);
        assert_eq!(
            converted[0].pointer("/toolCalls/0/function/arguments"),
            Some(&serde_json::json!({}))
        );
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
            tool_choice: None,
            request_id: None,
        };
        let usage = stream_chat_with_cancel(&state, &params, |chunk| {
            content.push_str(&chunk.delta);
            true
        }, None)
        .await
        .expect("stream");
        assert!(!content.trim().is_empty(), "原生接口应返回正文");
        println!("content={content}, usage={usage:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
