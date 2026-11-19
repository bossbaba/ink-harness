/** 模型来源：本地推理（Ollama/llama.cpp）或三方云端 API。 */
export type ModelSource = "local" | "remote";

/**
 * 模型能力声明，任务路由据此选择模型。
 *
 * 注意：目前路由实际只用到 `contextWindow` 与 `source`（本地/三方），
 * `tools` / `json` / `vision` 三项尚未在模型管理里采集，恒为 false，
 * 属于「已声明但未兑现」的契约——调用方读取它们之前需先补齐采集链路，
 * 不要把 false 当成模型真实不支持。见 `modelRouter.toModelInfo`。
 */
export interface ModelCapabilities {
  /** 上下文窗口（token 数），长篇续写依赖此值。 */
  contextWindow: number;
  /** @experimental 是否支持 function/tool calling，暂未采集，恒为 false。 */
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
  toolCallId?: string;
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
}

/** 流式输出的单个数据块。 */
export interface ChatChunk {
  delta: string;
  done: boolean;
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

/** Provider 下被启用的模型；能力先只保留路由必需字段。 */
export interface ProviderModel {
  id: string;
  displayName: string;
  /** 上下文窗口（token），任务路由据此过滤模型。 */
  contextWindow: number;
  costPer1kTokens?: number;
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
