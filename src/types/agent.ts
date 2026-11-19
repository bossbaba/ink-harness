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
  /** 统一的动作处理函数，由 composable 绑定好编辑器插入回调。 */
  onAction: (action: AgentPanelAction) => Promise<void>;
}

/** Agent 面板发出的动作，用共用事件收敛 approve/reject/insert/clear/toggle。 */
export type AgentPanelAction =
  | { type: "approve" | "reject"; id: string }
  | { type: "insert"; text: string }
  | { type: "clear" | "toggle" };

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
}

/** 追加轨迹入参。 */
export interface NewAgentStep {
  sessionId: string;
  iteration: number;
  toolCalls?: string;
  observations?: string;
  tokens?: number;
  latencyMs?: number;
}
