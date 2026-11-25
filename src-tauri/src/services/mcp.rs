//! MCP server 配置存取与 stdio 调用。
//!
//! 配置序列化成 JSON 存 app_meta，零迁移；每次 list/call 都 spawn 一个新进程，
//! 走完 initialize 握手即发请求，stdin 关闭后进程自然退出——不维护长驻进程，
//! 省掉僵尸回收、崩溃重启与 pending 请求表这些复杂状态。

use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::AppError;
use crate::infrastructure::db::DbState;

use super::mcp_protocol::{
    McpServerConfig, McpToolInfo, call_tool_request, initialized_notification,
    initialize_request, list_tools_request, parse_tool_list, result_for_id, tool_result_text,
};

/// app_meta 里存 MCP 配置的键。
const MCP_SERVERS_KEY: &str = "mcp_servers";
/// 单次 MCP 调用的超时：本地 server 启动慢，给 15 秒，避免坏配置卡住界面。
const CALL_TIMEOUT: Duration = Duration::from_secs(15);

/// 读全部 MCP server 配置；没配过返回空数组。
pub fn list_servers(state: &DbState) -> Result<Vec<McpServerConfig>, AppError> {
    let raw = super::setting::get(state, MCP_SERVERS_KEY)?;
    match raw {
        None => Ok(Vec::new()),
        Some(text) if text.trim().is_empty() => Ok(Vec::new()),
        Some(text) => Ok(serde_json::from_str(&text)?),
    }
}

/// server id 会作为工具名前缀 `id__tool` 出现在模型可见的注册表里。
/// 含 `__` 时无法唯一判断前缀在哪结束；其它特殊字符也会让工具名解析产生歧义。
fn valid_server_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.contains("__")
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 保存 MCP server 配置（按 id 覆盖或追加）。
pub fn save_server(
    state: &DbState,
    mut input: McpServerConfig,
) -> Result<Vec<McpServerConfig>, AppError> {
    input.id = input.id.trim().to_string();
    if input.id.is_empty() || input.command.trim().is_empty() {
        return Err(AppError::validation("MCP server 的 id 与命令不能为空"));
    }
    if !valid_server_id(&input.id) {
        return Err(AppError::validation(
            "MCP server id 只能包含字母、数字、下划线和连字符，且不能出现连续下划线",
        ));
    }
    let mut servers = list_servers(state)?;
    if let Some(existing) = servers.iter_mut().find(|item| item.id == input.id) {
        *existing = input;
    } else {
        servers.push(input);
    }
    persist_servers(state, &servers)?;
    Ok(servers)
}

/// 删除一个 MCP server 配置。
pub fn remove_server(state: &DbState, id: &str) -> Result<Vec<McpServerConfig>, AppError> {
    let mut servers = list_servers(state)?;
    servers.retain(|item| item.id != id);
    persist_servers(state, &servers)?;
    Ok(servers)
}

fn persist_servers(state: &DbState, servers: &[McpServerConfig]) -> Result<(), AppError> {
    super::setting::set(state, MCP_SERVERS_KEY, &serde_json::to_string(servers)?)
}

/// 列出所有启用 server 的工具。单个 server 失败只跳过它，不影响其它 server。
///
/// servers 由命令层读出后传进来：DbState 的 guard 不能跨 await 持有，
/// 把「读配置」和「进程通信」解耦才能让命令层安全调用。
pub async fn list_tools_for(servers: &[McpServerConfig]) -> Vec<McpToolInfo> {
    let mut all = Vec::new();
    for server in servers.iter().filter(|item| item.enabled) {
        match fetch_tools(server).await {
            Ok(mut tools) => all.append(&mut tools),
            Err(err) => eprintln!("MCP server {} 工具发现失败：{}", server.id, err),
        }
    }
    all
}

/// 调用一个 MCP 工具，返回文本结果；servers 同样由命令层传入。
pub async fn call_tool_for(
    servers: &[McpServerConfig],
    tool_name: &str,
    arguments: &Value,
) -> Result<String, AppError> {
    let enabled: Vec<&McpServerConfig> = servers.iter().filter(|item| item.enabled).collect();
    // 工具名带 server 前缀（如 srv1__read_file），先定位 server 再还原原始工具名。
    let (server, actual_name) = resolve_refs(&enabled, tool_name)
        .ok_or_else(|| AppError::not_found(format!("未找到 MCP 工具：{tool_name}")))?;
    let result = rpc_roundtrip(server, |id| call_tool_request(id, actual_name, arguments)).await?;
    Ok(tool_result_text(&result))
}

/// MCP 工具名在注册时用 `serverId__toolName` 避免不同 server 同名冲突。
pub fn qualified_name(server_id: &str, tool_name: &str) -> String {
    format!("{server_id}__{tool_name}")
}

/// 从启用 server 的引用列表里定位工具。
///
/// 只接受 `serverId__toolName` 这种明确前缀；无前缀一律拒绝。
/// 旧实现会退回第一个 server，模型凭空编一个工具名就可能打到某个外部进程上。
fn resolve_refs<'a, 'b>(
    servers: &[&'a McpServerConfig],
    qualified: &'b str,
) -> Option<(&'a McpServerConfig, &'b str)> {
    for server in servers {
        // 复用唯一的拼接规则：空工具名得到的就是前缀本身。
        let prefix = qualified_name(&server.id, "");
        if let Some(rest) = qualified.strip_prefix(&prefix) {
            if !rest.is_empty() {
                return Some((*server, rest));
            }
        }
    }
    None
}

async fn fetch_tools(server: &McpServerConfig) -> Result<Vec<McpToolInfo>, AppError> {
    let result = rpc_roundtrip(server, list_tools_request).await?;
    Ok(parse_tool_list(&server.id, &result))
}

/// 启动 server → initialize → initialized 通知 → 发一个请求 → 读响应 → 关闭。
async fn rpc_roundtrip<F>(server: &McpServerConfig, build: F) -> Result<Value, AppError>
where
    F: FnOnce(u64) -> Value,
{
    let future = async {
        let mut child = Command::new(&server.command)
            .args(&server.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|err| {
                AppError::upstream(format!(
                    "无法启动 MCP server {}（{}）：{err}",
                    server.name, server.command
                ))
            })?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::internal("MCP server 没有 stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("MCP server 没有 stdout"))?;
        let mut lines = BufReader::new(stdout).lines();

        // 握手：initialize（id=1）→ 等 result → initialized 通知。
        write_line(&mut stdin, &initialize_request(1)).await?;
        wait_for_id(&mut lines, 1).await?;
        write_line(&mut stdin, &initialized_notification()).await?;

        // 业务请求用 id=2，避免和握手的 id 混淆。
        write_line(&mut stdin, &build(2)).await?;
        let result = wait_for_id(&mut lines, 2).await?;

        // 关 stdin 让 server 自己退出；不等 wait()，kill_on_drop 会兜底清理。
        let _ = stdin.shutdown().await;
        Ok(result)
    };

    timeout(CALL_TIMEOUT, future)
        .await
        .map_err(|_| AppError::upstream(format!("MCP server {} 调用超时", server.name)))?
}

async fn write_line(stdin: &mut tokio::process::ChildStdin, value: &Value) -> Result<(), AppError> {
    let mut text = serde_json::to_string(value)?;
    text.push('\n');
    stdin
        .write_all(text.as_bytes())
        .await
        .map_err(|err| AppError::upstream(format!("写入 MCP server 失败：{err}")))?;
    stdin
        .flush()
        .await
        .map_err(|err| AppError::upstream(format!("刷新 MCP 输入失败：{err}")))?;
    Ok(())
}

/// 逐行读响应，跳过日志与无关 id，直到拿到目标 id 的 result。
async fn wait_for_id<R:tokio::io::AsyncBufRead + Unpin>(
    lines: &mut tokio::io::Lines<R>,
    id: u64,
) -> Result<Value, AppError> {
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|err| AppError::upstream(format!("读取 MCP 响应失败：{err}")))?
            .ok_or_else(|| AppError::upstream("MCP server 提前关闭了连接"))?;
        if let Some(result) = result_for_id(&line, id)? {
            return Ok(result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> McpServerConfig {
        McpServerConfig {
            id: id.into(),
            name: "测试服务".into(),
            command: "echo".into(),
            args: vec![],
            enabled: true,
        }
    }

    fn temp_state(tag: &str) -> DbState {
        let dir = std::env::temp_dir().join(format!("ih-mcp-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::infrastructure::db::open(&dir).unwrap()
    }

    #[test]
    fn list_servers_is_empty_by_default() {
        let state = temp_state("default");
        assert!(list_servers(&state).unwrap().is_empty());
    }

    #[test]
    fn save_overwrites_by_id_and_remove_deletes() {
        let state = temp_state("crud");
        save_server(&state, sample("a")).unwrap();
        let mut changed = sample("a");
        changed.command = "uvx".into();
        save_server(&state, changed).unwrap();
        save_server(&state, sample("b")).unwrap();
        let all = list_servers(&state).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].command, "uvx");
        let left = remove_server(&state, "a").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "b");
    }

    #[test]
    fn empty_id_or_command_is_rejected() {
        let state = temp_state("validate");
        let mut bad = sample("");
        assert!(save_server(&state, bad.clone()).is_err());
        bad.id = "x".into();
        bad.command = "".into();
        assert!(save_server(&state, bad).is_err());
    }

    #[test]
    fn qualified_name_and_resolve_roundtrip() {
        let servers = vec![sample("srv1"), sample("srv2")];
        let refs: Vec<&McpServerConfig> = servers.iter().collect();
        let name = qualified_name("srv2", "read_file");
        assert_eq!(name, "srv2__read_file");
        let (server, actual) = resolve_refs(&refs, &name).unwrap();
        assert_eq!(server.id, "srv2");
        assert_eq!(actual, "read_file");
    }

    #[test]
    fn unqualified_tool_name_is_rejected() {
        let servers = vec![sample("srv1"), sample("srv2")];
        let refs: Vec<&McpServerConfig> = servers.iter().collect();
        // 不再「退回第一个 server」：裸工具名无法判定归属，必须拒绝。
        assert!(resolve_refs(&refs, "read_file").is_none());
        assert!(resolve_refs(&refs, "srv1__").is_none());
    }

    #[test]
    fn server_id_with_double_underscore_is_rejected() {
        let state = temp_state("bad-id");
        // `a__b__tool` 无法唯一解析出 server 边界。
        assert!(save_server(&state, sample("a__b")).is_err());
        assert!(save_server(&state, sample("带空格 id")).is_err());
        assert!(save_server(&state, sample("ok-id_2")).is_ok());
    }

    #[test]
    fn disabled_servers_are_excluded() {
        let state = temp_state("disabled");
        let mut off = sample("off");
        off.enabled = false;
        save_server(&state, off).unwrap();
        save_server(&state, sample("on")).unwrap();
        let enabled: Vec<_> = list_servers(&state)
            .unwrap()
            .into_iter()
            .filter(|item| item.enabled)
            .collect();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "on");
    }
}
