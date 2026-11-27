//! MCP 命令层：配置 CRUD 走 blocking，工具发现/调用是 async 进程通信。
//!
//! IPC 只做适配：配置存哪、怎么与 stdio server 握手都在 services/mcp。
//! 异步命令里先同步读出配置（DbState guard 不跨 await），clone 后再交给 service。

use crate::commands::blocking;
use crate::error::AppError;
use crate::services::{approval, mcp};
use crate::services::mcp_protocol::{McpServerConfig, McpToolInfo};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[tauri::command]
pub async fn list_mcp_servers(app: tauri::AppHandle) -> Result<Vec<McpServerConfig>, AppError> {
    blocking(app, |state| mcp::list_servers(state)).await
}

#[tauri::command]
pub async fn save_mcp_server(
    app: tauri::AppHandle,
    input: McpServerConfig,
) -> Result<Vec<McpServerConfig>, AppError> {
    blocking(app, move |state| mcp::save_server(state, input)).await
}

#[tauri::command]
pub async fn remove_mcp_server(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<McpServerConfig>, AppError> {
    blocking(app, move |state| mcp::remove_server(state, &id)).await
}

#[tauri::command]
pub async fn list_mcp_tools(app: tauri::AppHandle) -> Result<Vec<McpToolInfo>, AppError> {
    let (servers, builtin_enabled) = {
        let state = app.state::<crate::infrastructure::db::DbState>();
        (
            mcp::list_servers(state.inner())?,
            mcp::builtin_web_search_enabled(state.inner())?,
        )
    };
    Ok(mcp::list_tools_for(&servers, builtin_enabled).await)
}

/// 读取内置联网搜索的开关；前端配置页据此渲染默认工具状态。
#[tauri::command]
pub async fn get_builtin_web_search(app: tauri::AppHandle) -> Result<bool, AppError> {
    blocking(app, |state| mcp::builtin_web_search_enabled(state)).await
}

/// 切换内置联网搜索；关掉后 Agent 工具清单里不再出现 web_search。
#[tauri::command]
pub async fn set_builtin_web_search(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, AppError> {
    blocking(app, move |state| {
        mcp::set_builtin_web_search_enabled(state, enabled)?;
        mcp::builtin_web_search_enabled(state)
    })
    .await
}

/// 签发一次性令牌前弹出原生确认框：这一步不经过 webview，脚本即使直接调 IPC
/// 也必须让用户在本机对话框里点「允许一次」。令牌本身只保证执行参数与确认时一致，
/// 不是跨进程的权限凭证；真正的人机闸门是这次原生确认。
#[tauri::command]
pub async fn issue_mcp_approval(
    app: tauri::AppHandle,
    tool: String,
    arguments: serde_json::Value,
    project_id: String,
    session_id: String,
) -> Result<String, AppError> {
    let args_text = serde_json::to_string(&arguments).unwrap_or_default();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!("即将执行外部工具 {tool}，参数：{args_text}\n\n只允许这一次。"))
        .title("外部工具调用确认")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "允许一次".into(),
            "取消".into(),
        ))
        .show(|approved| {
            let _ = tx.send(approved);
        });
    // 回调式弹窗不阻塞 async 运行时；对端消失（窗口已关）时按拒绝处理。
    if !rx.await.unwrap_or(false) {
        return Err(AppError::validation("已取消 MCP 调用"));
    }
    approval::issue(&tool, &arguments, &project_id, &session_id)
}

#[tauri::command]
pub async fn call_mcp_tool(
    app: tauri::AppHandle,
    name: String,
    arguments: serde_json::Value,
    project_id: String,
    session_id: String,
    approval_token: String,
) -> Result<String, AppError> {
    // 内置联网搜索是只读的 GET 请求，不碰本地数据，走不到外部进程审批闸门。
    // 精确匹配限定名，避免外部工具靠相似名字冒充内置工具绕过令牌校验。
    if !mcp::is_builtin_tool(&name) {
        // 闸门必须在 spawn 之前：参数不匹配、令牌重放或跨会话都直接拒绝执行外部进程。
        approval::verify(&approval_token, &name, &arguments, &project_id, &session_id)?;
    }
    let (servers, builtin_enabled) = {
        let state = app.state::<crate::infrastructure::db::DbState>();
        (
            mcp::list_servers(state.inner())?,
            mcp::builtin_web_search_enabled(state.inner())?,
        )
    };
    mcp::call_tool_for(&servers, builtin_enabled, &name, &arguments).await
}
