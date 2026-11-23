use serde::{Deserialize, Serialize};

/// Agent 会话：一条 Copilot 对话线程，按作品隔离。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 会话里的一条消息；tool_calls 存序列化后的 JSON（空串表示没有）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: String,
    /// 本次 Agent 循环的停止原因（no-tools/error/max-iterations/idle-loop）。
    /// 只有助手消息有值；看板用它算成功率，空串表示不是一次完整循环的产物。
    #[serde(default)]
    pub stop_reason: String,
    /// 本次提问携带的引用（序列化的 JSON 数组）；恢复会话时重建 @引用 标签。
    #[serde(default)]
    pub references: String,
    pub created_at: String,
}

/// Agent Loop 一轮的轨迹：工具调用、观察、token 与耗时。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRecord {
    pub id: String,
    pub session_id: String,
    pub iteration: i64,
    #[serde(default)]
    pub tool_calls: String,
    #[serde(default)]
    pub observations: String,
    pub tokens: i64,
    pub latency_ms: i64,
    /// 本轮使用的模型（providerId:modelId）；老记录为空串，看板据此跳过成本折算。
    #[serde(default)]
    pub model: String,
    pub created_at: String,
}

/// 新建会话的入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentSession {
    pub project_id: String,
    #[serde(default)]
    pub title: String,
}

/// 追加一条消息的入参；id 由前端生成（与内存消息 id 对齐）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: String,
    /// 循环停止原因；非 Agent 消息不传，落库为空串。
    #[serde(default)]
    pub stop_reason: String,
    /// 本次提问携带的引用，序列化成 JSON 数组字符串；老调用方不传落空串。
    #[serde(default)]
    pub references: String,
}

/// 追加一步轨迹的入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentStep {
    pub session_id: String,
    pub iteration: i64,
    #[serde(default)]
    pub tool_calls: String,
    #[serde(default)]
    pub observations: String,
    #[serde(default)]
    pub tokens: i64,
    #[serde(default)]
    pub latency_ms: i64,
    /// 本轮模型；老前端不传时落空串，成本折算自动跳过。
    #[serde(default)]
    pub model: String,
}

/// Agent 角色：只定义 prompt 与可用工具，不绑定具体模型。
/// tools 存 JSON 数组字符串；空串表示「全部工具」，便于新增工具自动对老角色生效。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRole {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub tools: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 新建/更新角色的入参：id 为空表示新建，非空表示按 id 更新。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentRole {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub tools: String,
}

/// 一次评测跑分的汇总：total/passed 算通过率，rounds/tokens/duration 看效率与成本。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvalRun {
    pub id: String,
    /// 评测所用作品；用例都基于该作品的数据，空串表示未指定。
    pub project_id: String,
    pub role_id: String,
    pub role_name: String,
    pub model: String,
    pub total: i64,
    pub passed: i64,
    pub rounds: i64,
    pub tokens: i64,
    pub duration_ms: i64,
    /// 逐例判定明细（JSON 数组），供历史回放与定位失败用例。
    pub details: String,
    pub created_at: String,
}

/// 追加一次评测结果；id 与 created_at 由后端生成。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentEvalRun {
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub role_id: String,
    #[serde(default)]
    pub role_name: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub passed: i64,
    #[serde(default)]
    pub rounds: i64,
    #[serde(default)]
    pub tokens: i64,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub details: String,
}

/// Agent 运行结果统计（看板成功率聚合）：按停止原因分组的轮次计数。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutcomeStats {
    /// 有停止原因的助手消息数 = 完整跑完的循环次数。
    pub runs: i64,
    /// no-tools：模型正常答完，算成功。
    pub succeeded: i64,
    /// max-iterations：到轮次上限仍未收敛。
    pub max_iterations: i64,
    /// idle-loop：重复工具请求被防空转保护掐停。
    pub idle: i64,
    /// error：请求失败。
    pub errors: i64,
}
