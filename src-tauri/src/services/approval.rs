//! 写操作的一次性审批令牌。
//!
//! 审批队列原本只在前端 TS 里，绕过界面的脚本可以直接调 IPC。这里给最高危的
//! `call_mcp_tool`（按用户配置 spawn 本地进程）加一道后端闸门：令牌签发前必须先
//! 经过原生确认框（见 `commands/mcp.rs`），令牌再绑定工具名、参数摘要、作品/会话，
//! 5 分钟内有效且用后即焚。令牌本身只防参数漂移与重放，不是跨进程权限凭证。
//!
//! 令牌存在进程内存里而非数据库：重启后前端审批队列也要重新授权，
//! 内存令牌随进程消失正好与「一次性」语义一致，也不需要额外的清理迁移。

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::error::AppError;
use crate::infrastructure::id::gen_id;

/// 令牌有效期。作者审批通常几秒内完成，5 分钟足够宽松又能限制泄漏窗口。
const TOKEN_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
struct Entry {
    tool: String,
    args_hash: u64,
    project_id: String,
    session_id: String,
    expires_at: Instant,
    used: bool,
}

static TOKENS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();

fn tokens() -> &'static Mutex<HashMap<String, Entry>> {
    TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 参数摘要只用于比对「审批时看到的」和「执行时提交的」是否是同一份参数。
/// serde_json 的 Map 默认按 key 排序，同一份参数的序列化文本稳定。
fn args_hash(args: &Value) -> u64 {
    let text = serde_json::to_string(args).unwrap_or_default();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

fn lock_error() -> AppError {
    AppError::internal("审批令牌存储不可用")
}

/// 签发一次性令牌，并顺手清掉过期项避免长期运行后无限增长。
pub fn issue(
    tool: &str,
    args: &Value,
    project_id: &str,
    session_id: &str,
) -> Result<String, AppError> {
    let token = gen_id("appr");
    let mut map = tokens().lock().map_err(|_| lock_error())?;
    map.retain(|_, item| item.expires_at > Instant::now());
    map.insert(
        token.clone(),
        Entry {
            tool: tool.to_string(),
            args_hash: args_hash(args),
            project_id: project_id.to_string(),
            session_id: session_id.to_string(),
            expires_at: Instant::now() + TOKEN_TTL,
            used: false,
        },
    );
    Ok(token)
}

/// 校验令牌与本次调用的绑定关系并消费它。任何一处不匹配都拒绝执行，
/// 且不消耗令牌（便于调用方在修正参数后重试）。
pub fn verify(
    token: &str,
    tool: &str,
    args: &Value,
    project_id: &str,
    session_id: &str,
) -> Result<(), AppError> {
    let mut map = tokens().lock().map_err(|_| lock_error())?;
    let entry = map
        .get_mut(token)
        .ok_or_else(|| AppError::validation("MCP 调用缺少有效的审批令牌"))?;
    // 过期项就地删除：只靠 issue 时清理的话，长期没有新审批时旧令牌会一直占着内存。
    if entry.expires_at <= Instant::now() {
        map.remove(token);
        return Err(AppError::validation("审批令牌已过期"));
    }
    if entry.used {
        return Err(AppError::validation("审批令牌已使用"));
    }
    if entry.tool != tool
        || entry.args_hash != args_hash(args)
        || entry.project_id != project_id
        || entry.session_id != session_id
    {
        return Err(AppError::validation("审批令牌与本次调用不匹配"));
    }
    entry.used = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn clear() {
        tokens().lock().unwrap().clear();
    }

    #[test]
    fn token_is_single_use() {
        clear();
        let args = json!({"path": "a.txt"});
        let token = issue("srv__read", &args, "p1", "s1").unwrap();
        assert!(verify(&token, "srv__read", &args, "p1", "s1").is_ok());
        assert!(verify(&token, "srv__read", &args, "p1", "s1").is_err());
    }

    #[test]
    fn mismatched_context_or_args_is_rejected_without_consuming() {
        clear();
        let args = json!({"path": "a.txt"});
        let token = issue("srv__read", &args, "p1", "s1").unwrap();
        assert!(verify(&token, "srv__read", &args, "p2", "s1").is_err());
        assert!(verify(&token, "srv__write", &args, "p1", "s1").is_err());
        assert!(verify(&token, "srv__read", &json!({"path": "b.txt"}), "p1", "s1").is_err());
        // 前面的失败不应消耗令牌，正确上下文仍可通过。
        assert!(verify(&token, "srv__read", &args, "p1", "s1").is_ok());
    }

    #[test]
    fn unknown_token_is_rejected() {
        clear();
        assert!(verify("not-a-token", "srv__read", &json!({}), "p1", "s1").is_err());
    }
}
