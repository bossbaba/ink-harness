//! 对话编排：把流式生成与 token 用量落库组合成一次完整调用。
//! 命令层只负责把回调接到 Tauri Channel，业务策略留在本层。

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{ChatChunk, ChatParams};
use crate::services::{cancel::CancelFlag, gateway, guardrails, usage};

/// 发起一次流式对话，结束后记录用量与真实输入输出（供审计回放）。
/// 用量/轨迹落库失败只记日志：对话已经生成完毕，不该反过来报错给用户。
///
/// `cancel` 由命令层按 requestId 注册；没有 requestId 的老调用方传 None。
pub async fn stream_with_usage<F>(
    state: &DbState,
    params: &ChatParams,
    mut on_chunk: F,
    cancel: Option<CancelFlag>,
) -> Result<(), AppError>
where
    F: FnMut(ChatChunk) -> bool,
{
    // 顺带累积正文：agent_run 的 output 列要写真实输出，而不是空串。
    let mut output = String::new();
    let token_usage = gateway::stream_chat_with_cancel(state, params, |chunk| {
        if !chunk.delta.is_empty() {
            output.push_str(&chunk.delta);
        }
        on_chunk(chunk)
    }, cancel.as_ref())
    .await?;
    if let Some(usage_data) = token_usage {
        // 审计文本再脱敏一次：流式逐块过滤会漏掉「凭据被切在两个 chunk 边界」的情况，
        // 这里对完整输出重跑规则，保证落库内容里不出现明文凭据。
        let audit_output = guardrails::scrub(&output);
        if let Err(err) = usage::record(state, params, &usage_data, &audit_output) {
            eprintln!("记录 token 用量失败：{err}");
        }
    }
    Ok(())
}
