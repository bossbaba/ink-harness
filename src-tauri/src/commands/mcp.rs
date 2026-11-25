//! MCP 命令层：配置 CRUD 走 blocking，工具发现/调用是 async 进程通信。
//!
//! IPC 只做适配：配置存哪、怎么与 stdio server 握手都在 services/mcp。
//! 异步命令里先同步读出配置（DbState guard 不跨 await），clone 后再交给 service。

use crate::commands::blocking;
use crate::error::AppError;
use crate::services::{approval, mcp};
use crate::services::mcp_protocol::{McpServerConfig, McpToolInfo};
use tauri::Manager;

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
    let servers = {
        let state = app.state::<crate::infrastructure::db::DbState>();
        mcp::list_servers(state.inner())?
    };
    Ok(mcp::list_tools_for(&servers).await)
}

/// 作者审批通过后由前端签发；后端只认这里发出的令牌，绕过界面的脚本拿不到。
#[tauri::command]
pub async fn issue_mcp_approval(
    tool: String,
    arguments: serde_json::Value,
    project_id: String,
    session_id: String,
) -> Result<String, AppError> {
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
    // 闸门必须在 spawn 之前：参数不匹配、令牌重放或跨会话都直接拒绝执行外部进程。
    approval::verify(&approval_token, &name, &arguments, &project_id, &session_id)?;
    let servers = {
        let state = app.state::<crate::infrastructure::db::DbState>();
        mcp::list_servers(state.inner())?
    };
    mcp::call_tool_for(&servers, &name, &arguments).await
}
