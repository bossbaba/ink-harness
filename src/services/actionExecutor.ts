import { findTool } from "@/services/agentTools";
import { scrubText } from "@/services/guardrails";
import type {
  AgentTool,
  CollectedToolCall,
  PendingToolAction,
  ToolContext,
  ToolObservation,
} from "@/types";

/**
 * 动作执行器：把模型给出的工具调用安全地变成观察结果。
 *
 * read 工具直接执行并把结果回填给模型；write 工具挂起到 pendingQueue，
 * 由作者点「通过/驳回」后才真正执行。这样即使模型误判，也不会改动作者的作品。
 */

/** 待审批队列，UI 通过 useAgentActions 订阅；这里用模块级状态，与会话生命周期一致。 */
let pendingSeq = 0;
const pending: PendingToolAction[] = [];

/** 简易参数校验：只检查 required 与类型，够拦住模型常见的字段缺失/类型错配。 */
function validateArgs(tool: AgentTool, args: Record<string, unknown>): string {
  const schema = tool.parameters as {
    required?: string[];
    properties?: Record<string, { type?: string; enum?: string[] }>;
  };
  for (const key of schema.required ?? []) {
    if (!(key in args)) return `缺少必填参数 ${key}`;
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (!(key in args)) continue;
    const value = args[key];
    // 可选参数传 null 很常见（模型把「不传」写成 null）：按未提供处理，不判类型错误。
    // 以前这里直接判类型，模型只要多写一个 null 就会被记成「工具执行报错」。
    if (value === null || value === undefined) continue;
    if (spec.type === "string" && typeof value !== "string") return `参数 ${key} 应为字符串`;
    if (spec.type === "boolean" && typeof value !== "boolean") return `参数 ${key} 应为布尔值`;
    if (spec.type === "number" && typeof value !== "number") return `参数 ${key} 应为数字`;
    if (spec.enum && !spec.enum.includes(String(value))) return `参数 ${key} 取值不在允许范围`;
  }
  return "";
}

/** 给模型的待审批提示：让它知道操作已提交、结果稍后由作者决定，而不是以为已经执行。 */
function approvalPrompt(action: PendingToolAction): string {
  return `工具 ${action.toolName} 已提交作者审批，当前未执行。作者的决定不会自动回填到本次对话，请基于已有信息继续或结束回答。`;
}

/** 执行一批工具调用，返回与之一一对应的观察结果（供下一轮请求作为 tool 消息）。 */
export async function executeCalls(
  calls: CollectedToolCall[],
  ctx: ToolContext,
): Promise<ToolObservation[]> {
  const results: ToolObservation[] = [];
  for (const call of calls) {
    results.push(await executeOne(call, ctx));
  }
  return results;
}

/** 执行单个调用：解析错误/未知工具/校验失败都转成 isError 观察，不中断整批。 */
async function executeOne(call: CollectedToolCall, ctx: ToolContext): Promise<ToolObservation> {
  const base = { toolCallId: call.id, toolName: call.name };
  if (call.parseError) {
    return { ...base, content: call.parseError, isError: true };
  }
  const tool = findTool(call.name);
  if (!tool) {
    return { ...base, content: `未注册的工具：${call.name}`, isError: true };
  }
  const invalid = validateArgs(tool, call.arguments);
  if (invalid) {
    return { ...base, content: `参数校验失败：${invalid}`, isError: true };
  }
  if (tool.risk === "write") {
    const action: PendingToolAction = {
      id: call.id || `pending-${++pendingSeq}`,
      toolName: call.name,
      label: describeAction(call),
      args: call.arguments,
      tool,
      status: "pending",
      error: "",
    };
    pending.push(action);
    return { ...base, content: approvalPrompt(action), isError: false };
  }
  try {
    // 工具结果会进下一轮提示词与界面气泡，先脱敏再回填（原因见 guardrails.ts）。
    const content = scrubText(await tool.run(call.arguments, ctx));
    return { ...base, content, isError: false };
  } catch (err) {
    return { ...base, content: `工具执行失败：${String(err)}`, isError: true };
  }
}

/** 生成给作者看的动作摘要；用 label 字段优先，否则显示工具名。 */
function describeAction(call: CollectedToolCall): string {
  const label = call.arguments.label;
  return typeof label === "string" && label.trim() ? label.trim() : `执行 ${call.name}`;
}

/** 返回当前待审批队列的副本（UI 只读展示，改动必须走 approve/reject）。 */
export function listPending(): PendingToolAction[] {
  return pending.map((item) => ({ ...item }));
}

/** 审批通过：执行工具的 run，结果由调用方（UI）决定如何落到作品里。 */
export async function approveAction(
  id: string,
  ctx: ToolContext,
): Promise<PendingToolAction | null> {
  const action = pending.find((item) => item.id === id);
  if (action?.status !== "pending") return null;
  try {
    // 审批通过后返回的结果会展示到卡片上，同样要脱敏。
    const result = scrubText(await action.tool.run(action.args, ctx));
    action.status = "applied";
    action.error = "";
    return { ...action, label: result };
  } catch (err) {
    action.status = "failed";
    action.error = String(err);
    return { ...action };
  }
}

/** 驳回：不执行，标记状态供 UI 显示「已驳回」。 */
export function rejectAction(id: string): PendingToolAction | null {
  const action = pending.find((item) => item.id === id);
  if (action?.status !== "pending") return null;
  action.status = "rejected";
  return { ...action };
}

/** 清空已完成（通过/驳回/失败）的动作，保留 pending 供下次审批。 */
export function clearFinished(): void {
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    if (pending[i].status !== "pending") pending.splice(i, 1);
  }
}

/** 仅测试用：清空全部队列。 */
export function resetPendingForTest(): void {
  pending.length = 0;
  pendingSeq = 0;
}
