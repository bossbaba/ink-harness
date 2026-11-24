//! 工作流审批命令：把正文写入与阶段状态提交收进一次 IPC。

use crate::commands::blocking;
use crate::error::AppError;
use crate::models::ApplyWorkflowInput;
use crate::services::workflow;

/// 一次事务完成正文（快照、RAG 纪元）与阶段状态写入；任一步失败全部回滚。
#[tauri::command]
pub async fn apply_workflow(app: tauri::AppHandle, input: ApplyWorkflowInput) -> Result<(), AppError> {
    blocking(app, move |state| workflow::apply_workflow(state, input)).await
}
