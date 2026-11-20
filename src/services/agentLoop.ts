import { executeCalls } from "@/services/actionExecutor";
import { filterToolDefinitions } from "@/services/agentRoleService";
import { toToolDefinitions } from "@/services/agentTools";
import { runChat } from "@/services/aiChat";
import type {
  ChatMessage,
  CollectedToolCall,
  PrivacyScope,
  TaskKind,
  ToolContext,
  ToolObservation,
} from "@/types";
import { parseLooseJson } from "@/utils/looseJson";

/**
 * Agent Loop：以「思考 → 行动 → 观察」循环驱动模型自主完成目标。
 *
 * 与一次性 runChat 的区别：模型每轮可以请求调用工具，执行器把结果作为 tool 消息
 * 回填，再让模型基于观察继续决策，直到它不再请求工具或达到轮次上限。
 *
 * 双轨制：模型声明支持 tools 时走标准 tool_calls；不支持的本地小模型走 JSON 降级——
 * 在 system 里要求模型输出约定格式的 JSON，用宽松解析器抠出工具调用。
 */

/** 一次循环的进度快照，供 UI 逐步展示与 P3 的 Trace 记录。 */
export interface AgentStep {
  iteration: number;
  /** 本轮模型的文本输出。 */
  text: string;
  calls: CollectedToolCall[];
  observations: ToolObservation[];
  /** 本轮消耗的 token 总数；上游没报用量时为 0。 */
  tokens: number;
  /** 本轮从发请求到收到完整回复的毫秒数，含工具执行前的模型耗时。 */
  latencyMs: number;
  /** 本轮实际使用的模型（providerId:modelId）；失败未选到模型时为空串。 */
  model: string;
}

/** 循环结束原因，便于 UI 给出不同文案与评估统计。 */
export type AgentStopReason = "no-tools" | "max-iterations" | "stopped" | "idle-loop" | "error";

export interface AgentLoopInput {
  task: TaskKind;
  privacy: PrivacyScope;
  projectId: string;
  /** 工具执行的项目/章节上下文。 */
  ctx: ToolContext;
  /** 已组装好的 system 提示（含作品上下文与回答纪律）。 */
  system: string;
  /** 之前的历史消息。 */
  history: ChatMessage[];
  /** 本轮用户问题。 */
  question: string;
  /** 模型是否支持标准工具调用；false 走 JSON 降级轨。 */
  supportsTools: boolean;
  /** 角色允许的工具名白名单；为空/不传表示全部工具。 */
  toolNames?: string[];
  /** 角色附加提示（如「你只挑硬伤」），拼在作品上下文之后。 */
  extraPrompt?: string;
  /** 最多循环轮次，默认 6。 */
  maxIterations?: number;
  /** 作者在 UI 点停止时返回 true；每轮开始前检查。 */
  shouldStop?: () => boolean;
  /** 每轮结束回调，用于流式展示与 Trace。 */
  onStep?: (step: AgentStep) => void;
}

export interface AgentLoopResult {
  /** 最终回答文本（最后一轮不再调用工具时的输出）。 */
  answer: string;
  reason: AgentStopReason;
  steps: AgentStep[];
  /** 失败原因；为空表示正常结束。 */
  failure: string;
}

/**
 * 把工具定义渲染成降级轨提示里的清单。
 *
 * 之前这里是手写的固定字符串，与实际注册表两份维护——加一个工具很容易漏改，
 * 模型在降级轨里就永远看不到它。现在从已下发的工具定义现生成，顺带按角色白名单
 * 自动收窄：角色只允许读章节时，清单里也不会出现写工具。
 */
function fallbackToolList(tools: ReturnType<typeof toToolDefinitions>): string {
  return tools
    .map((tool) => {
      const schema = tool.function.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const required = new Set(schema.required ?? []);
      const names = Object.keys(schema.properties ?? {});
      const args = names.map((name) => (required.has(name) ? `${name}*` : `${name}?`));
      return `- ${tool.function.name}(${args.join(",")})：${tool.function.description}`;
    })
    .join("\n");
}

/**
 * JSON 降级轨的提示词：让不支持 function calling 的模型以约定格式表达工具调用。
 * 带 `*` 的参数是必填项，和正式 schema 的 required 对齐。
 */
export function buildFallbackRule(tools = toToolDefinitions()): string {
  return [
    "【工具调用】",
    "如需读取作品信息或设定，可输出如下 JSON（只输出 JSON，不要其它文字）：",
    '{"tool_calls":[{"name":"工具名","arguments":{参数对象}}]}',
    "可用工具：",
    fallbackToolList(tools),
    "不需要调用工具时，直接正常回答，不要输出上述 JSON。",
  ].join("\n");
}

/** 从降级轨的文本里抠出工具调用；不是约定 JSON 时返回空数组。 */
export function parseFallbackCalls(text: string): CollectedToolCall[] {
  const value = parseLooseJson(text.trim());
  if (!value || typeof value !== "object") return [];
  const calls = (value as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as { name?: unknown; arguments?: unknown };
    if (typeof raw.name !== "string" || !raw.name) return [];
    const args = raw.arguments && typeof raw.arguments === "object" ? raw.arguments : {};
    return [
      {
        id: `fallback-${index}-${raw.name}`,
        name: raw.name,
        arguments: args as Record<string, unknown>,
        rawArguments: JSON.stringify(args),
        parseError: "",
      },
    ];
  });
}

/** 把一组调用转成 assistant 消息里的 tool_calls 字段（OpenAI 要求原样回传）。 */
function assistantToolCalls(calls: CollectedToolCall[]): ChatMessage["toolCalls"] {
  return calls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: { name: call.name, arguments: call.rawArguments },
  }));
}

/** 把两个调用的结果拼成用于空转检测的特征串。 */
function signature(calls: CollectedToolCall[]): string {
  return calls.map((call) => `${call.name}:${JSON.stringify(call.arguments)}`).join("|");
}

/**
 * 运行 Agent Loop。为便于单测，chatRunner 可注入；生产调用用默认的 runChat。
 */
export async function runAgentLoop(
  input: AgentLoopInput,
  chatRunner: typeof runChat = runChat,
): Promise<AgentLoopResult> {
  const maxIterations = Math.max(1, input.maxIterations ?? 6);
  const steps: AgentStep[] = [];
  // 角色白名单只裁剪下发与可见的工具；执行器仍按注册表校验，未下发的名字也调不通。
  const tools = filterToolDefinitions(toToolDefinitions(), input.toolNames ?? []);
  // 角色提示插在作品上下文之后：越靠后越贴近本次任务，模型更容易遵守。
  const baseSystem = input.extraPrompt
    ? `${input.system}\n\n【角色要求】\n${input.extraPrompt}`
    : input.system;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: input.supportsTools ? baseSystem : `${baseSystem}\n\n${buildFallbackRule(tools)}`,
    },
    ...input.history,
    { role: "user", content: input.question },
  ];

  let lastSignature = "";
  let idleRounds = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (input.shouldStop?.()) {
      return { answer: "", reason: "stopped", steps, failure: "" };
    }

    const startedAt = Date.now();
    const result = await chatRunner(
      {
        task: input.task,
        privacy: input.privacy,
        projectId: input.projectId,
        tools: input.supportsTools ? tools : undefined,
      },
      messages,
    );
    // 本轮的记账口径：tokens 取上游流末尾的用量（可能没有），耗时从发请求算到回复收齐。
    const tokens = result.usage?.totalTokens ?? 0;
    const latencyMs = Date.now() - startedAt;
    const model = result.model ?? "";
    if (result.failure) {
      return { answer: result.raw, reason: "error", steps, failure: result.failure };
    }

    // 标准轨从流式分片拼调用；降级轨从文本里抠约定 JSON。
    const calls = input.supportsTools ? result.toolCalls : parseFallbackCalls(result.raw);
    if (calls.length === 0) {
      const step: AgentStep = {
        iteration,
        text: result.raw,
        calls: [],
        observations: [],
        tokens,
        latencyMs,
        model,
      };
      steps.push(step);
      input.onStep?.(step);
      return { answer: result.raw, reason: "no-tools", steps, failure: "" };
    }

    // 空转检测：连续两轮请求完全相同的工具与参数就终止，避免模型卡在无效循环里。
    const current = signature(calls);
    idleRounds = current === lastSignature ? idleRounds + 1 : 0;
    lastSignature = current;
    if (idleRounds >= 1) {
      const step: AgentStep = {
        iteration,
        text: result.raw,
        calls,
        observations: [],
        tokens,
        latencyMs,
        model,
      };
      steps.push(step);
      input.onStep?.(step);
      return {
        answer: result.raw || "检测到重复的工具请求，已停止以免空转。",
        reason: "idle-loop",
        steps,
        failure: "",
      };
    }

    const observations = await executeCalls(calls, input.ctx);
    const step: AgentStep = {
      iteration,
      text: result.raw,
      calls,
      observations,
      tokens,
      latencyMs,
      model,
    };
    steps.push(step);
    input.onStep?.(step);

    // 把本轮助手消息（含工具调用）与执行结果一起回填，供下一轮模型继续决策。
    messages.push({
      role: "assistant",
      content: result.raw,
      toolCalls: input.supportsTools ? assistantToolCalls(calls) : undefined,
    });
    for (const observation of observations) {
      messages.push({
        role: "tool",
        content: observation.content,
        toolCallId: observation.toolCallId,
        name: observation.toolName,
      });
    }
  }

  return { answer: "", reason: "max-iterations", steps, failure: "" };
}
