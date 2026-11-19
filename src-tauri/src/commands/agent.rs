//! Agent 会话命令：只做 IPC 适配，持久化逻辑在 service 层。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{
    AgentMessage, AgentSession, AgentStepRecord, NewAgentMessage, NewAgentSession, NewAgentStep,
};
use crate::services::agent;

#[tauri::command]
pub async fn create_agent_session(
    app: tauri::AppHandle,
    input: NewAgentSession,
) -> Result<AgentSession, AppError> {
    blocking(app, move |state| agent::create_session(state, &input)).await
}

#[tauri::command]
pub async fn list_agent_sessions(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<AgentSession>, AppError> {
    blocking(app, move |state| agent::list_sessions(state, &project_id)).await
}

#[tauri::command]
pub async fn append_agent_message(
    app: tauri::AppHandle,
    input: NewAgentMessage,
) -> Result<(), AppError> {
    blocking(app, move |state| agent::append_message(state, &input)).await
}

#[tauri::command]
pub async fn list_agent_messages(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Vec<AgentMessage>, AppError> {
    blocking(app, move |state| agent::list_messages(state, &session_id)).await
}

#[tauri::command]
pub async fn append_agent_step(
    app: tauri::AppHandle,
    input: NewAgentStep,
) -> Result<(), AppError> {
    blocking(app, move |state| agent::append_step(state, &input)).await
}

#[tauri::command]
pub async fn list_agent_steps(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<AgentStepRecord>, AppError> {
    blocking(app, move |state| agent::list_steps(state, &project_id)).await
}
