//! Agent 会话命令：只做 IPC 适配，持久化逻辑在 service 层。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::{
    AgentEvalRun, AgentMessage, AgentOutcomeStats, AgentRole, AgentSession, AgentStepRecord,
    NewAgentEvalRun, NewAgentMessage, NewAgentRole, NewAgentSession, NewAgentStep,
};
use crate::services::{agent, agent_eval, agent_role};

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

#[tauri::command]
pub async fn agent_outcome_stats(app: tauri::AppHandle) -> Result<AgentOutcomeStats, AppError> {
    blocking(app, |state| agent::outcome_stats(state)).await
}

#[tauri::command]
pub async fn rename_agent_session(
    app: tauri::AppHandle,
    id: String,
    title: String,
) -> Result<(), AppError> {
    blocking(app, move |state| agent::rename_session(state, &id, &title)).await
}

#[tauri::command]
pub async fn delete_agent_session(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| agent::delete_session(state, &id)).await
}

#[tauri::command]
pub async fn list_agent_roles(app: tauri::AppHandle) -> Result<Vec<AgentRole>, AppError> {
    blocking(app, agent_role::list_roles).await
}

#[tauri::command]
pub async fn save_agent_role(
    app: tauri::AppHandle,
    input: NewAgentRole,
) -> Result<AgentRole, AppError> {
    blocking(app, move |state| agent_role::save_role(state, &input)).await
}

#[tauri::command]
pub async fn delete_agent_role(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    blocking(app, move |state| agent_role::delete_role(state, &id)).await
}

#[tauri::command]
pub async fn save_agent_eval_run(
    app: tauri::AppHandle,
    input: NewAgentEvalRun,
) -> Result<AgentEvalRun, AppError> {
    blocking(app, move |state| agent_eval::save_run(state, &input)).await
}

#[tauri::command]
pub async fn list_agent_eval_runs(
    app: tauri::AppHandle,
    limit: i64,
    project_id: Option<String>,
) -> Result<Vec<AgentEvalRun>, AppError> {
    blocking(app, move |state| agent_eval::list_runs(state, limit, project_id.as_deref())).await
}
