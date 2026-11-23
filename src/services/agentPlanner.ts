import { runChat } from "@/services/aiChat";
import type {
  AgentPlan,
  AgentPlanStep,
  AgentPlanStepStatus,
  ChatMessage,
  CollectedToolCall,
  PrivacyScope,
  TaskKind,
  ToolDefinition,
  ToolObservation,
} from "@/types";
import { parseLooseJson } from "@/utils/looseJson";

/**
 * 自主规划器（Planner）：把目标拆成可核对的步骤，并在读到新事实后重规划。
 *
 * 与「在 prompt 里说一句先想再做」不同，这里产出结构化计划并注入每轮 system，
 * 模型可用 update_plan 自主推进步骤、用 replan 请求重拆剩余任务。
 * 规划失败一律降级为「无计划的普通循环」，不让实验性能力影响既有写作流程。
 */

/** 规划时携带的作品上下文上限：目标往往只涉及一章，没必要重复塞进整本设定。 */
const PLAN_CONTEXT_LIMIT = 3000;
/** 一次拆解的步骤上限：小模型执行超过 5 步容易半途而废，轮次预算也不够。 */
const MAX_STEPS = 5;

/** 规划请求参数；chatRunner 可注入以便单测，不依赖真实模型。 */
export interface PlanInput {
  goal: string;
  /** 已组装的 Copilot system（含作品上下文），规划时会被截断。 */
  system: string;
  /** 当前角色允许的工具名；为空表示全部工具。 */
  toolNames: string[];
  task: TaskKind;
  privacy: PrivacyScope;
  projectId: string;
  requestId?: string;
  /** 重规划时传入旧计划，只保留已完成步骤作为事实。 */
  previous?: AgentPlan;
  /** 重规划触发原因，如「读到的事实与假设冲突」。 */
  reason?: string;
}

/** 规划结果；plan 为空表示模型没给出可用拆解，调用方应降级为普通循环。 */
export interface PlanResult {
  plan: AgentPlan | null;
  raw: string;
  failure: string;
  /** 规划请求消耗的 token；上游没报时为 0。 */
  tokens: number;
  latencyMs: number;
  model: string;
}

/** 规划器专用 system 提示：只要求结构化输出，不重复作品上下文以外的角色纪律。 */
function buildPlannerSystem(input: PlanInput): string {
  const tools = input.toolNames.length ? input.toolNames.join("、") : "全部已注册工具";
  return [
    "你是写作 Agent 的任务规划器。把目标拆成能按顺序执行的具体步骤。",
    `可用工具：${tools}。每步都必须能用这些工具完成，不要安排「思考一下」「总结一下」这类空步骤。`,
    `最多 ${MAX_STEPS} 步，只输出 JSON，不要任何解释文字：`,
    '{"steps":[{"title":"动作短句","intent":"这一步要达成什么"}]}',
    "【作品上下文（可能截断）】",
    input.system.slice(0, PLAN_CONTEXT_LIMIT),
  ].join("\n");
}

/** 首次规划与重规划用不同的问题：重规划只列剩余步骤，避免把已完成的事又做一遍。 */
function buildPlannerQuestion(input: PlanInput): string {
  if (!input.previous) return `目标：${input.goal}\n请拆分步骤并输出 JSON。`;
  const done = input.previous.steps
    .filter((step) => step.status === "done" || step.status === "skipped")
    .map((step) => `- ${step.title}：${step.result || "已完成"}`)
    .join("\n");
  return [
    `原始目标：${input.goal}`,
    `重规划原因：${input.reason || "原计划不再适用"}`,
    `已经完成（不要重复）：\n${done || "（无）"}`,
    "请只列出剩余步骤并输出 JSON；若目标已经达成，返回空 steps。",
  ].join("\n");
}

/** 把模型输出解析成计划；字段缺失或格式不对时尽量保留合法步骤，全错则返回 null。 */
export function parsePlan(
  raw: string,
  goal: string,
  version: number,
  reason = "",
): AgentPlan | null {
  const value = parseLooseJson(raw.trim());
  if (!value || typeof value !== "object") return null;
  const rawSteps = (value as { steps?: unknown }).steps;
  if (!Array.isArray(rawSteps)) return null;

  const steps: AgentPlanStep[] = [];
  for (const item of rawSteps) {
    // 达到上限就停：计划膨胀会拖垮轮次预算，多余的指令模型也执行不完。
    if (steps.length >= MAX_STEPS) break;
    if (!item || typeof item !== "object") continue;
    const { title, intent } = item as { title?: unknown; intent?: unknown };
    const label = typeof title === "string" ? title.trim() : "";
    if (!label) continue;
    steps.push({
      id: `s${steps.length + 1}`,
      title: label,
      intent: typeof intent === "string" && intent.trim() ? intent.trim() : label,
      status: steps.length === 0 ? "active" : "pending",
      result: "",
    });
  }
  return steps.length ? { goal, steps, version, reason } : null;
}

/** 生成计划；失败/无输出返回 plan=null，由调用方降级处理。 */
export async function makePlan(
  input: PlanInput,
  chatRunner: typeof runChat = runChat,
): Promise<PlanResult> {
  const startedAt = Date.now();
  const messages: ChatMessage[] = [
    { role: "system", content: buildPlannerSystem(input) },
    { role: "user", content: buildPlannerQuestion(input) },
  ];
  const result = await chatRunner(
    {
      task: input.task,
      privacy: input.privacy,
      projectId: input.projectId,
      requestId: input.requestId,
    },
    messages,
  );
  const base = {
    raw: result.raw,
    failure: result.failure,
    tokens: result.usage?.totalTokens ?? 0,
    latencyMs: Date.now() - startedAt,
    model: result.model ?? "",
  };
  if (result.failure || !result.raw.trim()) return { ...base, plan: null };
  return {
    ...base,
    plan: parsePlan(result.raw, input.goal, (input.previous?.version ?? 0) + 1, input.reason),
  };
}

/** 元工具：模型用它标记步骤完成。不进全局注册表，由 Loop 拦截执行并更新计划。 */
export const UPDATE_PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_plan",
    description:
      "标记任务计划中某一步的进展。每完成一步就调用一次并写明拿到的事实；全部完成后给出最终回答。",
    parameters: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "步骤 id，如 s1" },
        status: {
          type: "string",
          enum: ["done", "skipped", "active"],
          description: "done=已完成，skipped=跳过，active=正在做",
        },
        result: { type: "string", description: "这一步的结果摘要，供后续步骤使用" },
      },
      required: ["stepId", "status"],
      additionalProperties: false,
    },
  },
};

/** 元工具：模型发现计划不适用时主动请求重拆剩余步骤。 */
export const REPLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "replan",
    description: "当读到的作品事实与计划假设冲突、或原计划走不通时调用，请求重新拆解剩余步骤。",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "为什么要重规划" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
};

/** 元工具名，Loop 据此把计划调用从普通工具调用里分流出去。 */
export const PLAN_TOOL_NAMES = [UPDATE_PLAN_TOOL.function.name, REPLAN_TOOL.function.name];

/** 判断一个调用是否属于计划管理元工具。 */
export function isPlanTool(name: string): boolean {
  return PLAN_TOOL_NAMES.includes(name);
}

/** 状态到中文标签，回填给模型与界面共用一套叫法。 */
const STATUS_LABEL: Record<AgentPlanStepStatus, string> = {
  pending: "待做",
  active: "进行中",
  done: "已完成",
  skipped: "已跳过",
};

/**
 * 应用一组 update_plan 调用，返回新计划（不可变更新，便于 Vue 感知）与回填观察。
 * 未知 stepId / 非法 status 只返回错误观察，不改动计划，也不影响同批其它调用。
 */
export function applyPlanUpdates(
  plan: AgentPlan,
  calls: CollectedToolCall[],
): { plan: AgentPlan; observations: ToolObservation[] } {
  let next = plan;
  const observations: ToolObservation[] = [];
  for (const call of calls) {
    const stepId = typeof call.arguments.stepId === "string" ? call.arguments.stepId : "";
    const status = call.arguments.status;
    const valid: AgentPlanStepStatus[] = ["done", "skipped", "active"];
    const step = next.steps.find((item) => item.id === stepId);
    if (!step || !valid.includes(status as AgentPlanStepStatus)) {
      observations.push({
        toolCallId: call.id,
        toolName: call.name,
        content: `计划更新失败：步骤 ${stepId || "（未提供）"} 不存在或状态非法`,
        isError: true,
      });
      continue;
    }
    const result = typeof call.arguments.result === "string" ? call.arguments.result : "";
    next = {
      ...next,
      steps: next.steps.map((item) =>
        item.id === stepId
          ? { ...item, status: status as AgentPlanStepStatus, result: result || item.result }
          : item,
      ),
    };
    observations.push({
      toolCallId: call.id,
      toolName: call.name,
      content: `计划已更新：${step.title} → ${STATUS_LABEL[status as AgentPlanStepStatus]}`,
      isError: false,
    });
  }
  return { plan: next, observations };
}

/** 把计划渲染成注入 system / 写进矩阵的紧凑文本，已完成步骤带结果摘要。 */
export function planToText(plan: AgentPlan): string {
  const lines = plan.steps.map(
    (step) =>
      `${STATUS_LABEL[step.status]} ${step.id}. ${step.title}${
        step.result ? `（${step.result}）` : ""
      }`,
  );
  return [
    `【任务计划 v${plan.version}】目标：${plan.goal}`,
    ...lines,
    "用 update_plan 标记已完成的步骤；计划不适用时用 replan 请求重拆。",
  ].join("\n");
}
