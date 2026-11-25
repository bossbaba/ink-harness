import { executeCalls } from "@/services/actionExecutor";
import {
  assistantToolCalls,
  buildFallbackRule,
  buildToolRule,
  parseFallbackCalls,
  signature,
  TOOL_RETRY_PROMPT,
} from "@/services/agentLoopRules";
import {
  applyPlanUpdates,
  isPlanTool,
  makePlan,
  planToText,
  REPLAN_TOOL,
  UPDATE_PLAN_TOOL,
} from "@/services/agentPlanner";
import { filterToolDefinitions } from "@/services/agentRoleService";
import { toToolDefinitions } from "@/services/agentTools";
import { runChat } from "@/services/aiChat";
import type {
  AgentPlan,
  ChatMessage,
  CollectedToolCall,
  PrivacyScope,
  TaskKind,
  ToolContext,
  ToolDefinition,
  ToolObservation,
} from "@/types";

// 规则函数可能被外部按旧路径引用，这里保持向后兼容的再导出。
export { buildFallbackRule, buildToolRule, parseFallbackCalls } from "@/services/agentLoopRules";

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
  /** 阶段：plan=规划/重规划调用（iteration=0），work=普通行动轮。老轨迹没有此字段。 */
  phase?: "plan" | "work";
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
  /**
   * 是否启用自主规划：循环前先拆解任务，模型可用 update_plan 推进步骤、
   * 用 replan 请求重拆。默认 false——实验能力不能改变既有写作流程。
   */
  planning?: boolean;
  /** 最多重规划次数，默认 1；防止模型一遇挫折就反复重拆耗光轮次。 */
  maxReplans?: number;
  /** 计划生成或更新时的回调，供 UI 实时展示步骤清单。 */
  onPlan?: (plan: AgentPlan) => void;
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
  /** 最终计划；仅规划模式且成功拆解时有值。 */
  plan?: AgentPlan;
}

/**
 * 运行 Agent Loop。为便于单测，chatRunner 可注入；生产调用用默认的 runChat。
 *
 * 提示词规则与输出解析放在 agentLoopRules，这里只负责循环编排与状态推进。
 */
export async function runAgentLoop(
  input: AgentLoopInput,
  chatRunner: typeof runChat = runChat,
): Promise<AgentLoopResult> {
  const maxIterations = Math.max(1, input.maxIterations ?? 6);
  const steps: AgentStep[] = [];
  const planning = input.planning === true;
  const maxReplans = Math.max(0, input.maxReplans ?? 1);
  let plan: AgentPlan | null = null;
  let replans = 0;
  // 角色白名单既裁剪下发定义，也会原样传给执行器做二次校验：
  // JSON 降级轨能凭空写出任意工具名，只在下发时过滤是拦不住的。
  const baseTools = filterToolDefinitions(toToolDefinitions(), input.toolNames ?? []);
  // 规划元工具不进全局注册表：它们在循环里被拦截，用来推进/重拆计划而非执行业务。
  // 关闭规划时完全不下发，老角色与评测口径不受影响。
  const tools: ToolDefinition[] = planning
    ? [...baseTools, UPDATE_PLAN_TOOL, REPLAN_TOOL]
    : baseTools;
  // 角色提示插在作品上下文之后：越靠后越贴近本次任务，模型更容易遵守。
  const baseSystem = input.extraPrompt
    ? `${input.system}\n\n【角色要求】\n${input.extraPrompt}`
    : input.system;
  // 两条轨道都要把「先调工具再回答」写进 system：标准轨靠 tools 参数，降级轨靠约定 JSON，
  // 但两者都可能被「上下文没有就说未设定」的纪律带偏成纯文本作答。
  const systemRule = input.supportsTools ? buildToolRule(tools) : buildFallbackRule(tools);
  // 计划每次更新后都要重建 system：模型必须在每一轮都看到最新的步骤状态。
  const buildSystem = (current: AgentPlan | null): string =>
    `${baseSystem}\n\n${systemRule}${current ? `\n\n${planToText(current)}` : ""}`;
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystem(plan) },
    ...input.history,
    { role: "user", content: input.question },
  ];

  let lastSignature = "";
  let idleRounds = 0;
  // 首轮强制取数：拿到第一次工具调用后就关掉，后续轮次允许模型直接作答。
  let forceTool = input.requireToolFirst === true;
  let retriedFirst = false;

  // 循环前先拆解任务。规划调用本身也记一条轨迹（iteration=0），成本与耗时不丢；
  // 拆解失败或格式不对时降级为普通循环，不让实验性能力挡住已有问答流程。
  if (planning && !input.shouldStop?.()) {
    const planned = await makePlan(
      {
        goal: input.question,
        system: baseSystem,
        toolNames: input.toolNames ?? [],
        task: input.task,
        privacy: input.privacy,
        projectId: input.projectId,
        requestId: input.requestId,
      },
      chatRunner,
    );
    const planStep: AgentStep = {
      iteration: 0,
      text: planned.plan
        ? planToText(planned.plan)
        : `规划未采用（${planned.failure || "未解析出有效步骤"}），按普通循环继续。`,
      calls: [],
      observations: [],
      tokens: planned.tokens,
      latencyMs: planned.latencyMs,
      model: planned.model,
      phase: "plan",
    };
    steps.push(planStep);
    input.onStep?.(planStep);
    if (planned.plan) {
      plan = planned.plan;
      input.onPlan?.(plan);
      messages[0].content = buildSystem(plan);
    }
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (input.shouldStop?.()) {
      return { answer: "", reason: "stopped", steps, failure: "", plan: plan ?? undefined };
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
      return {
        answer: result.raw,
        reason: "error",
        steps,
        failure: result.failure,
        plan: plan ?? undefined,
      };
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
        phase: "work",
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
      return {
        answer: result.raw,
        reason: "no-tools",
        steps,
        failure: "",
        plan: plan ?? undefined,
      };
    }

    // 计划元工具与业务工具分流：前者改计划状态，后者才走执行器。
    const planCalls = planning ? calls.filter((call) => isPlanTool(call.name)) : [];
    const workCalls = calls.filter((call) => !isPlanTool(call.name));
    // 元工具调用代表「有进展」，不能按空转处理（update_plan 每轮参数本来就不同）。
    const hasPlanProgress = planCalls.length > 0;
    // 首轮强制取数只对真实业务工具生效：只标计划不算「已读到作品数据」。
    if (workCalls.length > 0) forceTool = false;

    // 空转检测：同一组调用重复出现时不立刻终止——模型常常是「没拿到有用结果，再试一遍」，
    // 先提醒它换个工具还有救；连续两次重复仍不改，才判定它在兜圈子。
    const current = signature(workCalls);
    const repeated = !hasPlanProgress && current === lastSignature;
    idleRounds = repeated ? idleRounds + 1 : 0;
    lastSignature = hasPlanProgress ? "" : current;
    if (repeated) {
      const step: AgentStep = {
        iteration,
        text: result.raw,
        calls,
        observations: [],
        tokens,
        latencyMs,
        model,
        phase: "work",
      };
      steps.push(step);
      input.onStep?.(step);
      if (idleRounds >= 2) {
        return {
          answer: result.raw || "检测到重复的工具请求，已停止以免空转。",
          reason: "idle-loop",
          steps,
          failure: "",
          plan: plan ?? undefined,
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

    // 先应用 update_plan（可能更新计划并通知 UI），再跑业务工具；最后按调用原序回填观察，
    // 保证 tool 消息与 assistant.tool_calls 一一对应。
    const planObservations = new Map<string, ToolObservation>();
    let replanReason = "";
    for (const call of planCalls) {
      if (call.name === REPLAN_TOOL.function.name) {
        if (plan && replans < maxReplans) {
          replanReason =
            typeof call.arguments.reason === "string" && call.arguments.reason.trim()
              ? call.arguments.reason.trim()
              : "模型请求重规划";
          planObservations.set(call.id, {
            toolCallId: call.id,
            toolName: call.name,
            content: `已接受重规划请求：${replanReason}`,
            isError: false,
          });
        } else {
          planObservations.set(call.id, {
            toolCallId: call.id,
            toolName: call.name,
            content: "当前没有计划或重规划次数已用完，请基于已有工具继续完成任务。",
            isError: false,
          });
        }
      }
    }
    const updateCalls = planCalls.filter((call) => call.name === UPDATE_PLAN_TOOL.function.name);
    if (plan && updateCalls.length > 0) {
      const applied = applyPlanUpdates(plan, updateCalls);
      plan = applied.plan;
      input.onPlan?.(plan);
      messages[0].content = buildSystem(plan);
      for (const observation of applied.observations) {
        planObservations.set(observation.toolCallId, observation);
      }
    }

    const workObservations = workCalls.length
      ? await executeCalls(workCalls, input.ctx, input.toolNames ?? [])
      : [];
    let workIndex = 0;
    const observations = calls.map((call) => {
      const planned = planObservations.get(call.id);
      return planned ?? workObservations[workIndex++];
    });
    const step: AgentStep = {
      iteration,
      text: result.raw,
      calls,
      observations,
      tokens,
      latencyMs,
      model,
      phase: "work",
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

    // 重规划放在本轮回填之后：模型下一轮才看到新计划，避免同一轮里计划前后不一致。
    if (replanReason && plan) {
      replans += 1;
      const revised = await makePlan(
        {
          goal: input.question,
          system: baseSystem,
          toolNames: input.toolNames ?? [],
          task: input.task,
          privacy: input.privacy,
          projectId: input.projectId,
          requestId: input.requestId,
          previous: plan,
          reason: replanReason,
        },
        chatRunner,
      );
      if (revised.plan) {
        plan = revised.plan;
        input.onPlan?.(plan);
        messages[0].content = buildSystem(plan);
      }
      const replanStep: AgentStep = {
        iteration: 0,
        text: revised.plan
          ? planToText(revised.plan)
          : `重规划未采用（${revised.failure || "未解析出有效步骤"}），沿用原计划。`,
        calls: [],
        observations: [],
        tokens: revised.tokens,
        latencyMs: revised.latencyMs,
        model: revised.model,
        phase: "plan",
      };
      steps.push(replanStep);
      input.onStep?.(replanStep);
    }
  }

  return {
    answer: "",
    reason: "max-iterations",
    steps,
    failure: "",
    plan: plan ?? undefined,
  };
}
