/**
 * Agent 工具系统的共享类型。
 *
 * 这里只放跨模块的数据结构：注册表、执行器、UI 卡片都依赖它们，
 * 避免各自重复定义导致字段漂移。
 */

import type { CollectedToolCall } from "./model";

/** 工具风险等级：read 自动执行，write 必须作者审批后才落库。 */
export type ToolRisk = "read" | "write";

/**
 * 自主规划（Planner）相关类型。
 *
 * 计划由模型先拆解、再由它在循环里用 update_plan 逐步推进；
 * 与「工具白名单 + prompt」的区别是：目标被显式拆成可核对的步骤，
 * 模型能在读到新事实后主动请求重规划，而不再是一路走到轮次上限。
 */

/** 计划步骤的状态；done/skipped 都会带结果摘要，供后续步骤与重规划使用。 */
export type AgentPlanStepStatus = "pending" | "active" | "done" | "skipped";

/** 任务分解后的一步，id 是模型更新状态时的定位键。 */
export interface AgentPlanStep {
  /** 稳定短 id（如 s1），模型用 update_plan 按它定位。 */
  id: string;
  /** 一句话动作描述，界面直接展示。 */
  title: string;
  /** 这一步要达成什么，作为子任务提示注入下一轮 system。 */
  intent: string;
  status: AgentPlanStepStatus;
  /** 完成/跳过的理由或拿到的关键事实，重规划时作为已完成事实回传。 */
  result: string;
}

/** 一次任务计划；每次重规划生成新版本，旧版本只留在轨迹里。 */
export interface AgentPlan {
  goal: string;
  steps: AgentPlanStep[];
  /** 计划版本号，从 1 开始，每次重规划 +1。 */
  version: number;
  /** 重规划原因；首次规划为空串。 */
  reason: string;
}

/** AI 面板里 Agent 相关的全部展示状态，打包成一个 prop 减少父子接口行数。 */
export interface AgentPanelState {
  actions: PendingToolAction[];
  busyId: string;
  error: string;
  mode: boolean;
  progress: string;
  /** 当前任务计划；仅规划模式且成功拆解时有值。 */
  plan: AgentPlan | null;
  /** 自主规划开关，默认关闭，避免影响既有写作流程。 */
  planning: boolean;
  /** 可选角色列表；空 roleId 表示默认角色（全部工具、无额外 prompt）。 */
  roles: AgentRole[];
  roleId: string;
  /** 统一的动作处理函数，由 composable 绑定好编辑器插入回调。 */
  onAction: (action: AgentPanelAction) => Promise<void>;
}

/** Agent 面板发出的动作，用共用事件收敛 approve/reject/insert/clear/toggle/role。 */
export type AgentPanelAction =
  | { type: "approve" | "reject"; id: string }
  | { type: "insert"; text: string }
  | { type: "clear" | "discard" | "toggle" | "toggle-planning" }
  | { type: "role"; id: string };

/** 工具执行上下文：由调用方（Agent Loop / Copilot）注入，工具本身不直接读全局状态。 */
export interface ToolContext {
  projectId: string;
  /** 当前选中的章节 id；读章节/写正文类工具的默认目标。 */
  chapterId?: string;
  /**
   * 当前会话 id，仅用于审批队列按会话隔离，不下发给工具执行。
   * 老调用方不传时用空串，保持兼容。
   */
  sessionId?: string;
  /**
   * 作者审批通过后由后端签发的 MCP 调用令牌；只有外部工具会用到。
   * 签发前会弹原生确认框；后端在 spawn 外部进程前校验令牌与参数绑定，
   * 未签发或串参的调用会被拒绝。
   */
  approvalToken?: string;
}

/**
 * 工具定义：name/description/parameters 直接构成发给模型的 OpenAI function schema；
 * risk 决定执行策略，run 是真正干活的函数。
 * 内置工具的 run 只调本地 service；MCP 外部工具的 run 走 IPC 调后端 spawn 的进程，
 * 这是有意的例外——外部能力本来就只能经 Rust 侧代理。
 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema（对象形式），用于参数校验与发给模型。 */
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  /** 外部 MCP 工具：执行前必须由后端签发一次性审批令牌。 */
  external?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/**
 * 写操作审批预览中的一处改动。
 *
 * 只描述「原文 → 替换」这一层，不试图还原整章 diff：模型提交的本来就是片段替换，
 * 逐条列出才能对应到它的修改意图，也方便作者一眼看出哪条不对。
 */
export interface ToolActionPreviewItem {
  /** 稳定短 id，与工具参数里的条目顺序对应，界面做 key 用。 */
  id: string;
  /** 将被替换的原文片段（可能已按显示需要截断）。 */
  quote: string;
  /** 替换后的文字（已脱敏，与真正写入正文的内容一致）。 */
  replacement: string;
  /** 原文或替换文字被截断时为 true，提示作者完整内容仍会写入。 */
  truncated: boolean;
}

/** 写操作的逐条改动预览；没有结构化差异的工具（如 propose_text）不生成预览。 */
export interface ToolActionPreview {
  /** 即将被修改的目标描述，如「章节 c1」；无法判定时为空串。 */
  target: string;
  items: ToolActionPreviewItem[];
  /** 因格式问题（空 quote、非字符串等）被跳过的条目数。 */
  skipped: number;
}

/** 一个待作者审批的写操作。 */
export interface PendingToolAction {
  /** 对应工具调用 id，界面用它做 key 与定位。 */
  id: string;
  toolName: string;
  /** 给作者看的简短说明，如「替换第 3 章的 2 处文字」。 */
  label: string;
  /**
   * 已解析且**已脱敏**的参数；审批通过后原样交给 run。
   * 脱敏必须发生在入队时而非执行后，否则真正写进正文的仍是带凭据的原文（见 actionExecutor）。
   */
  args: Record<string, unknown>;
  /** 逐条改动预览，仅 apply_edits 有值；审批卡片据此展示差异。 */
  preview?: ToolActionPreview;
  /** 执行该操作的工具，审批通过后直接调用。 */
  tool: AgentTool;
  status: "pending" | "approved" | "rejected" | "applied" | "failed";
  /** 执行失败原因；成功或待审批时为空。 */
  error: string;
}

/** 执行一个工具调用的结果，回填给模型作为观察。 */
export interface ToolObservation {
  toolCallId: string;
  toolName: string;
  /** 成功时的结果文本；待审批时给模型「已提交作者审批」的提示。 */
  content: string;
  /** 是否出错（参数非法/工具未找到/执行失败）。 */
  isError: boolean;
}

/** 把模型给出的完整调用转成 tool 角色的消息内容，供下一轮请求使用。 */
export function toToolMessage(observation: ToolObservation): {
  role: "tool";
  content: string;
  toolCallId: string;
  name: string;
} {
  return {
    role: "tool",
    content: observation.content,
    toolCallId: observation.toolCallId,
    name: observation.toolName,
  };
}

/** 未解析分片之外的便捷类型别名，供 UI 直接引用。 */
export type AgentCall = CollectedToolCall;

/** 持久化的会话（对应 Rust agent_session）。 */
export interface AgentSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** 持久化的消息（对应 Rust agent_message）。 */
export interface AgentMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  toolCalls: string;
  /** 循环停止原因（no-tools/error/…）；普通消息与老记录为空串。 */
  stopReason: string;
  /** 本次提问携带的引用，JSON 数组字符串；老记录为空串。 */
  references: string;
  createdAt: string;
}

/** 持久化的一步轨迹（对应 Rust agent_step）。 */
export interface AgentStepRecord {
  id: string;
  sessionId: string;
  iteration: number;
  toolCalls: string;
  observations: string;
  tokens: number;
  latencyMs: number;
  /** 本轮模型（providerId:modelId）；老记录为空串，成本折算自动跳过。 */
  model: string;
  createdAt: string;
}

/** 新建会话入参。 */
export interface NewAgentSession {
  projectId: string;
  title?: string;
}

/** 追加消息入参。 */
export interface NewAgentMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  toolCalls?: string;
  /** Agent 循环的停止原因；普通聊天不传。 */
  stopReason?: string;
  /** 本次提问携带的引用，序列化成 JSON 数组字符串；普通回答不传。 */
  references?: string;
}

/** 追加轨迹入参。 */
export interface NewAgentStep {
  sessionId: string;
  iteration: number;
  toolCalls?: string;
  observations?: string;
  tokens?: number;
  latencyMs?: number;
  model?: string;
}

/**
 * Agent 角色：只定义 prompt 与工具白名单，不绑定模型。
 * tools 是 JSON 数组字符串；空串表示「全部工具」，新增工具对老角色自动生效。
 */
export interface AgentRole {
  id: string;
  name: string;
  prompt: string;
  tools: string;
  createdAt: string;
  updatedAt: string;
}

/** 新建/更新角色入参：id 为空表示新建。 */
export interface NewAgentRole {
  id?: string;
  name: string;
  prompt?: string;
  tools?: string;
}

/**
 * 评测页进行中状态：done 是已完成用例数，title 是当前正在跑的用例。
 * phase 区分「准备数据 / 正在跑 / 正在停止」，避免只有一个百分比时看不出卡在哪一步。
 */
export interface AgentEvalProgressState {
  phase: "idle" | "preparing" | "running" | "stopping";
  done: number;
  total: number;
  title: string;
}

/** 进度面板里的单个用例：状态由已完成数推导，不额外维护一份易失真的选中态。 */
export interface AgentEvalProgressStep {
  title: string;
  status: "done" | "active" | "pending";
}

/** 评测里单个用例的结果，落库时序列化成 details。 */
export interface AgentEvalCaseResult {
  caseId: string;
  title: string;
  /** 是否通过：期望工具命中 + 无错误观察 + 有最终回答才算通过。 */
  ok: boolean;
  /** 未通过原因，界面直接展示，便于定位是模型能力还是用例本身的问题。 */
  reason: string;
  rounds: number;
  /** 本用例实际调到的工具名，按轮次顺序。 */
  calls: string[];
  tokens: number;
}

/** 一次评测跑分（对应 Rust agent_eval_run）。 */
export interface AgentEvalRun {
  id: string;
  projectId: string;
  roleId: string;
  roleName: string;
  model: string;
  total: number;
  passed: number;
  rounds: number;
  tokens: number;
  durationMs: number;
  /** 逐例明细 JSON 字符串。 */
  details: string;
  createdAt: string;
}

/** 评测历史表格的一行：落库记录加上页面派生的通过率、明细与趋势。 */
export interface AgentEvalHistoryRow extends AgentEvalRun {
  rate: number;
  cases: AgentEvalCaseResult[];
  delta: number | null;
}

/** 追加评测结果入参（id/createdAt 由后端生成）。 */
export interface NewAgentEvalRun {
  projectId?: string;
  roleId?: string;
  roleName?: string;
  model?: string;
  total?: number;
  passed?: number;
  rounds?: number;
  tokens?: number;
  durationMs?: number;
  details?: string;
}

/**
 * Copilot 面板顶部会话条的状态（打包成一个 prop 减少父子接口行数）。
 * 角色选择不在这里：它只影响 Agent 模式，放在 Agent 控制区（AgentControls）更贴近语义。
 */
export interface CopilotSessionBarState {
  sessions: AgentSession[];
  currentId: string;
  loading: boolean;
  error: string;
  onAction: (action: CopilotSessionAction) => void | Promise<void>;
}

/** 会话条动作：新建/切换/重命名/删除会话。 */
export type CopilotSessionAction =
  | { type: "new" }
  | { type: "switch"; id: string }
  | { type: "rename"; id: string; title: string }
  | { type: "delete"; id: string };

/** Agent 运行结果统计（对应 Rust AgentOutcomeStats），看板算成功率用。 */
export interface AgentOutcomeStats {
  /** 完整跑完的循环次数（有助手停止原因的消息数）。 */
  runs: number;
  /** 正常答完（no-tools）的次数。 */
  succeeded: number;
  /** 到轮次上限仍未收敛的次数。 */
  maxIterations: number;
  /** 空转保护掐停的次数。 */
  idle: number;
  /** 请求失败的次数。 */
  errors: number;
}
