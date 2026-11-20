/**
 * Agent 工具系统的共享类型。
 *
 * 这里只放跨模块的数据结构：注册表、执行器、UI 卡片都依赖它们，
 * 避免各自重复定义导致字段漂移。
 */

import type { CollectedToolCall } from "./model";

/** 工具风险等级：read 自动执行，write 必须作者审批后才落库。 */
export type ToolRisk = "read" | "write";

/** AI 面板里 Agent 相关的全部展示状态，打包成一个 prop 减少父子接口行数。 */
export interface AgentPanelState {
  actions: PendingToolAction[];
  busyId: string;
  error: string;
  mode: boolean;
  progress: string;
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
  | { type: "clear" | "toggle" }
  | { type: "role"; id: string };

/** 工具执行上下文：由调用方（Agent Loop / Copilot）注入，工具本身不直接读全局状态。 */
export interface ToolContext {
  projectId: string;
  /** 当前选中的章节 id；读章节/写正文类工具的默认目标。 */
  chapterId?: string;
}

/**
 * 工具定义：name/description/parameters 直接构成发给模型的 OpenAI function schema；
 * risk 决定执行策略，run 是真正干活的函数（只调用现有 service，不碰 IPC）。
 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema（对象形式），用于参数校验与发给模型。 */
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/** 一个待作者审批的写操作。 */
export interface PendingToolAction {
  /** 对应工具调用 id，界面用它做 key 与定位。 */
  id: string;
  toolName: string;
  /** 给作者看的简短说明，如「替换第 3 章的 2 处文字」。 */
  label: string;
  /** 已解析的参数；审批通过后用它执行 run。 */
  args: Record<string, unknown>;
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
