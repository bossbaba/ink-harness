//! 调用用量 DTO：token 看板的聚合结果，与写库/查询逻辑分离。

use serde::Serialize;

/// 按任务聚合的一行：任务名、调用次数、消耗 token。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUsage {
    pub task_kind: String,
    pub calls: i64,
    pub tokens: i64,
}

/// 按模型聚合的一行：模型标识、调用次数、消耗 token。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub calls: i64,
    pub tokens: i64,
}

/// 看板总览：总量与按任务、按模型拆分。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub calls: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub by_task: Vec<TaskUsage>,
    pub by_model: Vec<ModelUsage>,
}
