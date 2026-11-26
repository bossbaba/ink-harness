import { scrubArgs } from "@/services/guardrails";
import { modelRouter } from "@/services/modelRouter";
import type {
  ChatMessage,
  CollectedToolCall,
  PrivacyScope,
  TaskKind,
  TokenUsage,
  ToolCallChunk,
  ToolDefinition,
} from "@/types";
import { parseFirstJsonObject } from "@/utils/looseJson";

/**
 * 流式对话的统一入口。
 *
 * 之前每个业务服务（摘要/工作流/出版简报/审稿/AI 辅助/对话）都自己写一遍
 * 「refresh → select → chat → await done → 判空」，样板重复，且错误口径不一致：
 * 有的把真实原因（网络、鉴权、配额）吞掉，只剩一句「模型没有返回内容」。
 * 现在统一收在这里，调用方只关心「拿到全文」「工具调用」和「失败原因」。
 */

/** 没有可用模型时的统一文案；六处服务原本各写一句，措辞还不一样。 */
export const NO_MODEL_MESSAGE = "没有可用模型，请先在模型管理里配置并启用 Provider。";

/** 模型返回空内容时的统一文案。 */
export const EMPTY_REPLY_MESSAGE = "模型没有返回内容，可以再试一次。";

export interface ChatRoute {
  task: TaskKind;
  privacy: PrivacyScope;
  projectId?: string;
  /** 本次可用的工具定义；非空且模型支持时随请求下发。 */
  tools?: ToolDefinition[];
  /** 要求本轮必须先调用工具（首轮取数用）；模型不支持工具时自动忽略。 */
  requireTool?: boolean;
  /** 请求 ID，用于停止时中断后端流式请求。 */
  requestId?: string;
}

export interface ChatRunResult {
  /** 累计收到的全文（已拼接增量）。 */
  raw: string;
  /** 拼接并解析完成的工具调用；没有工具时为空数组。 */
  toolCalls: CollectedToolCall[];
  /** 失败原因；为空表示流正常结束。 */
  failure: string;
  /** 流末尾上游给的 token 用量；上游没给就是 undefined。 */
  usage?: TokenUsage;
  /** 本次实际选中的模型（providerId:modelId）；没选到可用模型时为空。 */
  model?: string;
}

/** 正在接收分片的一次调用；同一 index 可能被上游重复用于下一次调用。 */
interface ToolCallDraft {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/** arguments 已经是一个完整对象：再收到从 `{` 开头的帧，多半是上游补发的完整副本。 */
function isCompleteObject(text: string): boolean {
  if (!text.trim()) return false;
  try {
    const value: unknown = JSON.parse(text);
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * 把流式到达的工具分片按 index 拼成完整调用。
 *
 * OpenAI 的 arguments 是逐帧追加的 JSON 片段，id/name 只在首帧出现；
 * 但同一 index 也可能被上游复用给下一次调用，此时 id/name 会变化，
 * 必须另起一条，否则两次参数拼成 `{"query":"..."}{}` 这样的坏 JSON。
 * 解析失败不抛异常，而是把原文与原因放进结果，由执行器拒绝执行该工具。
 */
export function collectToolCalls(chunks: ToolCallChunk[]): CollectedToolCall[] {
  const drafts: ToolCallDraft[] = [];
  for (const chunk of chunks) {
    // 只把分片归给 id/name 兼容的同 index 调用；变了就说明是新的一次调用。
    let draft = [...drafts]
      .reverse()
      .find(
        (item) =>
          item.index === chunk.index &&
          (!chunk.id || !item.id || item.id === chunk.id) &&
          (!chunk.name || !item.name || item.name === chunk.name),
      );
    if (!draft) {
      draft = { index: chunk.index, id: "", name: "", arguments: "" };
      drafts.push(draft);
    }
    if (chunk.id) draft.id = chunk.id;
    if (chunk.name) draft.name = chunk.name;
    // 已有完整对象又来一帧完整对象时跳过，避免拼出两个连着的 JSON。
    if (isCompleteObject(draft.arguments) && /^\s*[{[]/.test(chunk.arguments)) continue;
    draft.arguments += chunk.arguments;
  }
  return drafts
    .sort((a, b) => a.index - b.index)
    .map((entry) => {
      let parsed: Record<string, unknown> = {};
      let parseError = "";
      const text = entry.arguments.trim();
      if (text) {
        try {
          const value: unknown = JSON.parse(text);
          if (value && typeof value === "object" && !Array.isArray(value)) {
            // 工具参数会被回填进下一轮提示词并随会话落库，入口处先洗一遍，
            // 不让 read/MCP 工具把外部资料里的凭据带进 SQLite。
            parsed = scrubArgs(value) as Record<string, unknown>;
          } else {
            parseError = "工具参数不是 JSON 对象";
          }
        } catch (err) {
          // 模型可能把两次参数连写或带上一句说明：第一段对象可用就继续执行，
          // 原文仍留在 rawArguments，真正无救时才记解析错误。
          const salvaged = parseFirstJsonObject(text);
          if (salvaged) {
            parsed = scrubArgs(salvaged) as Record<string, unknown>;
          } else {
            parseError = `工具参数解析失败：${String(err)}`;
          }
        }
      }
      return {
        id: entry.id,
        name: entry.name,
        arguments: parsed,
        rawArguments: entry.arguments,
        parseError,
      };
    });
}

/**
 * 跑一次流式对话。
 *
 * - 先 `refresh()` 再 `select()`：模型管理页刚改过配置时也能选到新 Provider；
 * - 失败原因由 `onError` 收集到 `failure` 返回，而不是在这里抛，
 *   这样调用方可以先做自己的兜底（比如判空、降级）再抛出带上下文的文案；
 * - `done` 只可能在「无可用模型 / 隐私拦截」时 reject，且那两种情况已经走过
 *   `onError`，所以这里的 catch 只是防止 unhandled rejection。
 */
export async function runChat(
  route: ChatRoute,
  messages: ChatMessage[],
  onProgress?: (received: number) => void,
): Promise<ChatRunResult> {
  await modelRouter.refresh();
  const selected = modelRouter.select(route);
  if (!selected) {
    return { raw: "", toolCalls: [], failure: NO_MODEL_MESSAGE };
  }
  // 选中的模型要带回给调用方：Agent 轨迹按它折算成本、排查「换了模型效果变了」。
  const model = `${selected.provider}:${selected.id}`;

  let raw = "";
  let failure = "";
  let usage: TokenUsage | undefined;
  const fragments: ToolCallChunk[] = [];
  const handle = modelRouter.chat(
    route,
    messages,
    (chunk) => {
      if (chunk.delta) {
        raw += chunk.delta;
        onProgress?.(raw.length);
      }
      if (chunk.toolCalls?.length) fragments.push(...chunk.toolCalls);
      // 用量只在流末尾出现一次，取最后一块即可。
      if (chunk.usage) usage = chunk.usage;
    },
    (message) => {
      failure = message;
    },
    route.tools,
    route.requireTool ? "required" : undefined,
  );
  await handle.done.catch(() => undefined);
  return { raw, toolCalls: collectToolCalls(fragments), failure, usage, model };
}
