/** 模型来源：本地推理（Ollama/llama.cpp）或三方云端 API。 */
export type ModelSource = "local" | "remote";

/**
 * 模型能力声明，任务路由据此选择模型。
 *
 * `tools` 来自模型管理页的显式勾选（ProviderModel.supportsTools），
 * 决定 Agent Loop 走标准 tool_calls 还是 JSON 降级轨；
 * `json` / `vision` 仍未采集，恒为 false，读取前需先补采集链路。
 */
export interface ModelCapabilities {
  /** 上下文窗口（token 数），长篇续写依赖此值。 */
  contextWindow: number;
  /** 是否支持 function/tool calling；由模型管理页勾选，未勾选即走 JSON 降级轨。 */
  tools: boolean;
  /** @experimental 是否支持 JSON mode，暂未采集，恒为 false。 */
  json: boolean;
  /** @experimental 是否支持多模态输入，暂未采集，恒为 false。 */
  vision: boolean;
  /** 是否支持流式输出，当前统一按支持处理。 */
  streaming: boolean;
}

/** 已登记可用的模型描述。 */
export interface ModelInfo {
  id: string;
  provider: string;
  source: ModelSource;
  /** 界面显示名。 */
  displayName: string;
  capabilities: ModelCapabilities;
  /** 每 1k token 成本（本地模型为 0）；用于成本看板。 */
  costPer1kTokens?: number;
}

/** 对话消息。 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  /** tool 角色消息对应的调用 id，上游据此匹配上一次的工具请求。 */
  toolCallId?: string;
  /**
   * assistant 消息里模型给出的完整工具调用（OpenAI 格式）。
   * 多轮工具对话必须把上一次的调用原样回传，否则上游会拒绝后续的 tool 消息。
   */
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/** 工具定义（OpenAI 兼容格式）。 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 统一对话请求参数。 */
export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** 作品是否仅允许本地模型（隐私分级，Rust 侧强制）。 */
  privacyLocalOnly?: boolean;
  /** 任务与作品只用于用量统计，不影响模型选择。 */
  taskKind?: string;
  projectId?: string;
  /**
   * 工具调用策略：`required` 要求本轮先调用工具，`auto`/不传由模型自行决定。
   * 目前只在「首轮取数」时用 required，避免小模型拿着空白上下文直接编答案。
   */
  toolChoice?: "auto" | "required";
  /** 本次请求 ID，仅用于停止时调用 cancel_chat；不下发给模型。 */
  requestId?: string;
}

/**
 * 流式返回的工具调用分片。
 *
 * OpenAI 兼容接口把一次调用拆成多帧：id/name 只在首帧出现，arguments 逐块追加；
 * Ollama 原生接口一次给全。两端都已归一，调用方按 index 拼接即可还原完整调用。
 */
export interface ToolCallChunk {
  /** 同一次响应里区分多个工具的序号。 */
  index: number;
  /** 调用 id，后续分片为空串。 */
  id: string;
  /** 工具名，后续分片为空串。 */
  name: string;
  /** 参数 JSON 片段（增量），全部拼完才是合法 JSON。 */
  arguments: string;
}

/** 流式返回的 token 用量；上游不一定给，Agent 轨迹记账用它。 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 流式输出的单个数据块。 */
export interface ChatChunk {
  delta: string;
  done: boolean;
  /** 工具调用分片；普通文本块没有此字段或为空数组。 */
  toolCalls?: ToolCallChunk[];
  /** 流末尾的 token 用量；上游没给就没有此字段。 */
  usage?: TokenUsage;
}

/**
 * 拼接并解析完成的工具调用，供 Agent Loop 执行。
 * rawArguments 保留原文：解析失败时仍能把现场交给界面排查。
 */
export interface CollectedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
  /** 参数不是合法 JSON 时的原因；非空时不应执行该工具。 */
  parseError: string;
}

/** 任务类型，用于路由到不同偏好的模型。 */
export type TaskKind =
  | "ideation"
  | "copilot"
  | "continue"
  | "rewrite"
  | "expand"
  | "condense"
  | "polish"
  | "review"
  | "summary"
  | "publish";

/** 路由策略。 */
export type RouteStrategy = "quality" | "cost" | "privacy";

/** Provider 下被启用的模型。 */
export interface ProviderModel {
  id: string;
  displayName: string;
  /** 上下文窗口（token），任务路由据此过滤模型。 */
  contextWindow: number;
  costPer1kTokens?: number;
  /** 是否支持 function/tool calling；模型管理页显式勾选，未勾选走 JSON 降级轨。 */
  supportsTools?: boolean;
}

/** 新勾选模型的默认上下文窗口，弹窗里可再调整。 */
export const DEFAULT_CONTEXT_WINDOW = 8192;

/** Provider 配置（不含密钥本体，密钥存系统钥匙串）。 */
export interface ProviderConfig {
  id: string;
  name: string;
  source: ModelSource;
  /** 例：本地 http://localhost:11434/v1；云端 https://api.deepseek.com/v1。 */
  baseUrl: string;
  /** 系统钥匙串中的条目键名，非密钥明文。 */
  apiKeyRef?: string;
  enabled: boolean;
  models: ProviderModel[];
}

/** 探测连接入参：允许在保存前用未落库的密钥测试。 */
export interface ProbeProviderInput {
  baseUrl: string;
  apiKey?: string;
  /** 已保存过密钥时只传引用，由后端从系统钥匙串取明文。 */
  apiKeyRef?: string;
}

/** 作品是否仅允许本地模型处理。 */
export type PrivacyScope = "any" | "local-only";

/** Ollama 服务检测结果。 */
export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: string[];
}
