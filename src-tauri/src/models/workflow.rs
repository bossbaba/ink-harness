use serde::Deserialize;

use super::draft::SaveContentInput;

/// 工作流审批落地入参：阶段决定、审批后的整份状态 JSON，以及可选的正文写入。
///
/// 把「写正文 + 写阶段状态」合成一次调用，是为了让 Rust 侧能在一个事务里完成两件事。
/// 以前前端分两次 IPC，中途失败会留下「正文已覆盖但阶段仍待审批」或
/// 「界面显示已通过但正文没写」的半写状态。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWorkflowInput {
    /// 作品 ID：阶段状态按作品存 app_meta，键由它拼出。
    pub project_id: String,
    /// 阶段名，与前端 WorkflowStage 联合类型一致。
    pub stage: String,
    /// "approved" 或 "rejected"，用来校验前端传来的新状态是否自洽。
    pub decision: String,
    /// 前端执行完 decideStage 后的整份状态 JSON。
    pub workflow_json: String,
    /// 写作/编辑审批通过时需要写入的正文；其它阶段为空。
    pub content_write: Option<SaveContentInput>,
}
