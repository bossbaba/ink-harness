/** 模型来源：本地推理（Ollama/llama.cpp）或三方云端 API。 */
export type ModelSource = "local" | "remote";

/** 模型能力声明，任务路由据此选择模型。 */
export interface ModelCapabilities {
  /** 上下文窗口（token 数），长篇续写依赖此值。 */
  contextWindow: number;
  /** 是否支持 function/tool calling。 */
  tools: boolean;
  /** 是否支持 JSON mode。 */
  json: boolean;
  /** 是否支持多模态输入。 */
  vision: boolean;
  /** 是否支持流式输出。 */
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
}

/** 流式输出的单个数据块。 */
export interface ChatChunk {
  delta: string;
  done: boolean;
}

/** 任务类型，用于路由到不同偏好的模型。 */
export type TaskKind =
  | "ideation"
  | "continue"
  | "rewrite"
  | "expand"
  | "polish"
  | "review"
  | "summary";

/** 路由策略。 */
export type RouteStrategy = "quality" | "cost" | "privacy";

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
  models: ModelInfo[];
}

/** 作品是否仅允许本地模型处理。 */
export type PrivacyScope = "any" | "local-only";

/** Ollama 服务检测结果。 */
export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: string[];
}
