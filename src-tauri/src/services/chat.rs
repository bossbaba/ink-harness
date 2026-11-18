//! 对话编排：把流式生成与 token 用量落库组合成一次完整调用。
//! 命令层只负责把回调接到 Tauri Channel，业务策略留在本层。

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{ChatChunk, ChatParams};
use crate::services::{gateway, usage};

/// 发起一次流式对话，结束后记录用量。
/// 用量落库失败只记日志：对话已经生成完毕，不该反过来报错给用户。
pub async fn stream_with_usage<F>(
    state: &DbState,
    params: &ChatParams,
    on_chunk: F,
) -> Result<(), AppError>
where
    F: FnMut(ChatChunk) -> bool,
{
    let token_usage = gateway::stream_chat(state, params, on_chunk).await?;
    if let Some(usage_data) = token_usage {
        if let Err(err) = usage::record(state, params, &usage_data) {
            eprintln!("记录 token 用量失败：{err}");
        }
    }
    Ok(())
}
