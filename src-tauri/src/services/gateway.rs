//! 模型网关领域服务：流式对话编排。
//! 不依赖任何 Tauri 类型——流式输出通过回调注入，便于纯 Rust 单测。
//!
//! 纯解析逻辑已拆到同目录的 `gateway_sse.rs`（SSE 方言）、`gateway_jsonl.rs`（Ollama 原生
//! JSON Lines）、`gateway_stream.rs`（共用事件与 JSON 取值）与 `gateway_resolve.rs`
//! （Provider 解析），本文件只保留「解析 → 隐私校验 → 重试 → 读流 → 回调」的编排主链路，
//! 以控制单文件规模；那些模块各自的单测随代码一起迁移。

use std::time::Duration;

use futures_util::StreamExt;
use tokio::time::timeout;

use crate::error::AppError;
use crate::infrastructure::{db::DbState, llm_http};
use crate::models::{ChatChunk, ChatParams, TokenUsage};
use crate::services::{
    cancel::CancelFlag, gateway_tools, guardrails, project, provider_kind,
};

use super::gateway_resolve::{ResolvedProvider, resolve_provider};
use super::gateway_jsonl::JsonlParser;
use super::gateway_sse::SseParser;
use super::gateway_stream::SseEvent;

/// 两种上游响应格式共用同一套事件，调用方不需要按方言分支。
enum StreamParser {
    Sse(SseParser),
    Jsonl(JsonlParser),
}

impl StreamParser {
    fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        match self {
            Self::Sse(parser) => parser.push(chunk),
            Self::Jsonl(parser) => parser.push(chunk),
        }
    }
}

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
    // 地址也要参与判定：老库里可能存着 source=local 但 base_url 指向公网的脏配置，
    // 只看 source 会让「仅本地」的承诺在运行时被静默破坏。
    if local_only
        && !provider_kind::is_local_endpoint(&resolved.provider.source, &resolved.provider.base_url)
    {
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
        gateway_tools::native_messages(&params.messages)
    } else {
        gateway_tools::openai_messages(&params.messages)
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
    // 有些模型标着支持工具调用，实际却拒绝我们发的 tools schema（如 mimo 的
    // `tools.0.function.parameters is not valid type`）。这种 400 重试多少次都没用，
    // 去掉 tools 再发一次让模型退回纯文本，由调用方的降级轨解析工具意图。
    let mut dropped_tools = false;
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
                // 工具 schema 被拒：去掉 tools 与 tool_choice 原样重发一次。
                // 只认明确提到 tools/function 的 400，避免把其它参数错误也悄悄降级。
                let has_tools = body
                    .get("tools")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|tools| !tools.is_empty());
                if status.as_u16() == 400 && !dropped_tools && has_tools && gateway_tools::mentions_tool_schema(&text)
                {
                    eprintln!("模型拒绝 tools schema，去掉工具定义后重试：{}", truncate(&text, 160));
                    gateway_tools::strip_tooling(&mut body);
                    dropped_tools = true;
                    continue;
                }
                if retryable && attempt + 1 < llm_http::MAX_ATTEMPTS {
                    eprintln!("模型请求返回 {status}，第 {} 次重试", attempt + 1);
                    tokio::time::sleep(llm_http::backoff(attempt)).await;
                    attempt += 1;
                    continue;
                }
                // 上游错误体可能回显请求头（含 Authorization），先脱敏再截断，
                // 否则密钥片段会顺着 AppError.message 一直显示到界面上。
                let clean = guardrails::scrub(&text);
                return Err(AppError::upstream(format!(
                    "模型返回错误 {status}：{}",
                    truncate(&clean, 500)
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
        StreamParser::Jsonl(JsonlParser::new())
    } else {
        StreamParser::Sse(SseParser::new())
    };
    let mut usage: Option<TokenUsage> = None;
    // 凭据可能被切在两个 delta 的边界上，单块 scrub 两次都匹配不到。
    // 留一小段尾部到下一轮和新增文本拼起来再洗，确认安全的前半部分照常逐字推送。
    const TAIL_KEEP: usize = 32;
    let mut pending = String::new();
    // 上游可能整条流什么都不给：端点方言不兼容、思考字段被拒、连接中途被截断。
    // 这时前端拿到的 raw 是空串，界面只剩一个「【第 1 轮】」，作者无从判断发生了什么。
    // 记下到底有没有产出，并留一段原始响应，出问题时回显出来才有排查价值。
    let mut saw_output = false;
    let mut raw_sample = String::new();
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
        let text = String::from_utf8_lossy(&bytes);
        // 诊断样本只留开头几百字：够看出端点返回的是什么方言，又不至于把整篇回复塞进错误信息。
        if raw_sample.len() < RAW_SAMPLE_LIMIT {
            raw_sample.push_str(&text);
        }
        let events = parser.push(&text);
        for event in events {
            match event {
                SseEvent::Done => {
                    // 流结束前把尾部缓冲洗完推掉，否则最后几十个字会丢。
                    if !pending.is_empty() {
                        let safe = guardrails::scrub(&pending);
                        if !safe.is_empty() && !on_chunk(ChatChunk::delta(safe)) {
                            return Err(AppError::internal("对话已被取消"));
                        }
                        pending.clear();
                    }
                    if !saw_output {
                        return Err(empty_stream_error(
                            &resolved.provider.name,
                            &resolved.model,
                            &resolved.provider.base_url,
                            &guardrails::scrub(&raw_sample),
                        ));
                    }
                    return if on_chunk(ChatChunk::done()) {
                        Ok(usage)
                    } else {
                        Err(AppError::internal("对话已被取消"))
                    };
                }
                SseEvent::Delta(text) => {
                    // 以未脱敏的原文判断「上游到底有没有说话」：被脱敏规则清空不等于没输出。
                    if !text.trim().is_empty() {
                        saw_output = true;
                    }
                    // 模型可能被提示词注入带去吐凭据，先把上一轮尾部和新文本合起来洗；
                    // 只推送确定安全的前缀，尾部继续留着应对下一次切分。
                    pending.push_str(&text);
                    let safe = guardrails::scrub(&pending);
                    let keep_from = safe
                        .char_indices()
                        .rev()
                        .nth(TAIL_KEEP - 1)
                        .map(|(index, _)| index)
                        .unwrap_or(0);
                    let (ready, tail) = safe.split_at(keep_from);
                    if !ready.is_empty() && !on_chunk(ChatChunk::delta(ready.to_string())) {
                        return Err(AppError::internal("对话已被取消"));
                    }
                    pending.clear();
                    pending.push_str(tail);
                }
                SseEvent::ToolCall(mut call) => {
                    // 工具调用也是有效产出：模型可能整轮只调工具、不说话。
                    saw_output = true;
                    // 工具参数同样会显示到界面并进入下一轮提示词，不能只洗正文 delta。
                    call.arguments = guardrails::scrub(&call.arguments);
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

    if !saw_output {
        return Err(empty_stream_error(
            &resolved.provider.name,
            &resolved.model,
            &resolved.provider.base_url,
            &guardrails::scrub(&raw_sample),
        ));
    }
    if on_chunk(ChatChunk::done()) {
        Ok(usage)
    } else {
        Err(AppError::internal("对话已被取消"))
    }
}

/// 诊断样本最多保留的字节数：够看出端点返回的是什么，又不至于把整篇回复塞进错误信息。
const RAW_SAMPLE_LIMIT: usize = 800;

/// 上游整条流既没有正文也没有工具调用时构造可诊断的错误。
///
/// 这种情况前端拿到的是空回复，界面只会剩一个「【第 1 轮】」。
/// 把 Provider、模型名、地址和原始响应片段一并回显，作者才能判断是端点方言不兼容还是模型真的没说话。
fn empty_stream_error(provider_name: &str, model: &str, base_url: &str, sample: &str) -> AppError {
    let detail = if sample.trim().is_empty() {
        "上游没有返回任何可解析的数据。".to_string()
    } else {
        format!("上游响应片段：{}", truncate(sample, 200))
    };
    AppError::upstream(format!(
        "模型「{provider_name}/{model}」（{base_url}）没有返回任何内容：既没有正文也没有工具调用。{detail}"
    ))
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

    /// 空响应必须给出能定位问题的错误：光说「没有内容」，作者还是不知道该换模型还是换端点。
    #[test]
    fn empty_stream_error_points_at_provider_model_and_sample() {
        let err = empty_stream_error(
            "本地 MiMo",
            "mimo-v2.6-9b",
            "http://127.0.0.1:8000/v1",
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"只有思考\"}}]}",
        );
        assert!(err.message.contains("本地 MiMo"));
        assert!(err.message.contains("mimo-v2.6-9b"));
        assert!(err.message.contains("127.0.0.1:8000"));
        // 原始片段要能看到，作者才能判断上游到底回了什么。
        assert!(err.message.contains("reasoning"));
    }

    /// 完全没有可解析数据时也要说清楚，不能只给一句空话。
    #[test]
    fn empty_stream_error_without_sample_still_explains() {
        let err = empty_stream_error("本地", "m", "http://127.0.0.1:1/v1", "   ");
        assert!(err.message.contains("没有返回任何可解析的数据"));
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
