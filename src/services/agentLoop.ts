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
  /**
   * 首轮要求模型必须先调用工具：下发 `tool_choice: required`，若模型仍直接作答，
   * 补一次明确追问再试。只影响首轮，拿到工具结果后恢复自由作答。
   */
  requireToolFirst?: boolean;
  /**
   * 本次请求 ID：循环里的每一轮都带上它，作者点停止时后端能中断当前这一轮，
   * 而不只是等这一轮输出完再靠 shouldStop 拦下一轮。
   */
  requestId?: string;
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
 * 标准轨（模型支持 function calling）的工具使用提示。
 *
 * 只把 tools 丢给上游是不够的：system 里既有「作品上下文」又写着「没有的信息就说未设定」，
 * 模型会很自然地直接照着上下文作答，甚至回一句「作品尚未建立任何设定」——实测 Agent 评测
 * 5 条用例全部 `calls: []`。所以这里显式写清「先取数据再回答」，并重复工具名，
 * 避免模型忽略 tools 参数。
 */
export function buildToolRule(tools = toToolDefinitions()): string {
  return [
    "【工具使用】",
    "1. 只要问题涉及作品内容（作品信息、设定、章节、资料检索），本轮第一步必须是调用工具；拿到工具结果之前，不得输出任何作品相关内容。",
    "2. 禁止凭上下文中已有的片段作答：上下文字段可能缺失或过期，作品数据一律以工具返回为准。",
    "3. 除非工具明确返回「没有 / 不存在」，不要回答「未设定」「暂无」「尚未建立」。",
    "4. 一轮可以并行调用多个工具，拿到结果后再组织回答；同一个工具不要反复调用来回试。",
    "5. 自检：如果你的回答里出现具体人物、情节或设定，而本轮没有调用过工具，说明你在编造，必须改成先调用工具。",
    "6. 可用工具（按用途选择，读正文用 read_chapter、找资料用 search_notes，别用列表工具代替）：",
    // 带上用途而不是只列名字：只给名字时小模型经常拿 list_elements 当「读内容」用。
    ...tools.map((tool) => `- ${tool.function.name}：${firstSentence(tool.function.description)}`),
  ].join("\n");
}

/** 取描述的第一句：工具描述都写成「一句话用途 + 补充说明」，清单里只要第一句。 */
function firstSentence(text: string): string {
  const end = text.indexOf("。");
  return end > 0 ? text.slice(0, end + 1) : text;
}

/**
 * JSON 降级轨的提示词：让不支持 function calling 的模型以约定格式表达工具调用。
 * 带 `*` 的参数是必填项，和正式 schema 的 required 对齐。
 */
export function buildFallbackRule(tools = toToolDefinitions()): string {
  return [
    "【工具调用】",
    "需要作品数据（作品信息、设定条目、章节正文、检索片段）时，必须先输出如下 JSON 获取，",
    "不要凭上下文空白直接回答「未设定」「暂无」。只输出 JSON，不要其它文字：",
    '{"tool_calls":[{"name":"工具名","arguments":{参数对象}}]}',
    "可用工具：",
    fallbackToolList(tools),
    "确实不需要作品数据时，直接正常回答，不要输出上述 JSON。",
  ].join("\n");
}

/** 首轮没调工具时的补问：直接说下一步动作，比再讲一遍规则更容易被小模型执行。 */
const TOOL_RETRY_PROMPT =
  "刚才那一步没有调用任何工具。请先调用工具读取所需的作品数据（如 get_project、list_elements、read_chapter、search_notes），再回答上面的问题。";

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
  // 两条轨道都要把「先调工具再回答」写进 system：标准轨靠 tools 参数，降级轨靠约定 JSON，
  // 但两者都可能被「上下文没有就说未设定」的纪律带偏成纯文本作答。
  const systemRule = input.supportsTools ? buildToolRule(tools) : buildFallbackRule(tools);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${baseSystem}\n\n${systemRule}`,
    },
    ...input.history,
    { role: "user", content: input.question },
  ];

  let lastSignature = "";
  let idleRounds = 0;
  // 首轮强制取数：拿到第一次工具调用后就关掉，后续轮次允许模型直接作答。
  let forceTool = input.requireToolFirst === true;
  let retriedFirst = false;

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
        requireTool: forceTool,
        requestId: input.requestId,
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
      // 首轮要求取数但模型还是直接作答：多半是拿着上下文空白编内容。补一条追问再试一次，
      // 只补一次——再问不出来说明这个模型根本不听工具指令，继续追问只会拖长等待。
      if (forceTool && !retriedFirst) {
        retriedFirst = true;
        if (result.raw.trim()) messages.push({ role: "assistant", content: result.raw });
        messages.push({ role: "user", content: TOOL_RETRY_PROMPT });
        continue;
      }
      return { answer: result.raw, reason: "no-tools", steps, failure: "" };
    }

    // 已经拿到工具调用，后续轮次不再强制，让模型基于观察结果自由作答。
    forceTool = false;

    // 空转检测：同一组调用重复出现时不立刻终止——模型常常是「没拿到有用结果，再试一遍」，
    // 先提醒它换个工具还有救；连续两次重复仍不改，才判定它在兜圈子。
    const current = signature(calls);
    const repeated = current === lastSignature;
    idleRounds = repeated ? idleRounds + 1 : 0;
    lastSignature = current;
    if (repeated) {
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
      if (idleRounds >= 2) {
        return {
          answer: result.raw || "检测到重复的工具请求，已停止以免空转。",
          reason: "idle-loop",
          steps,
          failure: "",
        };
      }
      // 第一次重复：不再白跑一遍工具，直接把「换个方式」的提醒回填成观察结果。
      // 仍要回填 assistant 的 tool_calls，否则 OpenAI 协议里这些 tool 消息没有对应调用。
      messages.push({
        role: "assistant",
        content: result.raw,
        toolCalls: input.supportsTools ? assistantToolCalls(calls) : undefined,
      });
      for (const call of calls) {
        messages.push({
          role: "tool",
          content: `刚才已经用相同参数调用过 ${call.name}，返回结果没有变化。请换用其它工具（例如读正文用 read_chapter、检索用 search_notes），或基于已有结果直接回答。`,
          toolCallId: call.id,
          name: call.name,
        });
      }
      continue;
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
