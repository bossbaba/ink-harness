import { buildWritePreview } from "@/services/actionPreview";
import { findTool } from "@/services/agentTools";
import { scrubArgs, scrubText } from "@/services/guardrails";
import type {
  AgentTool,
  CollectedToolCall,
  PendingToolAction,
  ToolContext,
  ToolObservation,
} from "@/types";
import { getScopedStorage } from "@/utils/localStorageStore";

/**
 * 动作执行器：把模型给出的工具调用安全地变成观察结果。
 *
 * read 工具直接执行并把结果回填给模型；write 工具挂起到 pendingQueue，
 * 由作者点「通过/驳回」后才真正执行。这样即使模型误判，也不会改动作者的作品。
 */

/**
 * 待审批队列按「作品::会话」隔离。
 *
 * 原来是单个模块级数组：切到另一部作品后，界面仍会列出上一部作品的待授权操作；
 * 作者在那里点「通过」，用的又是新作品的 ctx，极易把修改落到错误的章节。
 * 现在按上下文分桶，切会话/作品只看到自己那一份，审批时也用同一份 ctx 定位。
 */
let pendingSeq = 0;
const pendingByScope = new Map<string, PendingToolAction[]>();

/** 本地持久化前缀：只存「待审批」，终态和已批准执行中的动作重启后不再恢复。 */
const PENDING_STORAGE_PREFIX = "ink:pending-actions:";

/** 可序列化的动作快照；`tool`（含 run 函数）不能 JSON 化，恢复时按工具名重建。 */
interface StoredAction {
  id: string;
  toolName: string;
  label: string;
  args: Record<string, unknown>;
  error: string;
}

/** 读取某作用域的待审批快照；结构不对或损坏时当作空队列。 */
function readStored(key: string): StoredAction[] {
  const store = getScopedStorage(PENDING_STORAGE_PREFIX);
  if (!store) return [];
  try {
    const raw = store.get(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredAction => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<StoredAction>;
      return (
        typeof value.id === "string" &&
        typeof value.toolName === "string" &&
        Boolean(value.args) &&
        typeof value.args === "object"
      );
    });
  } catch {
    return [];
  }
}

/** 写回快照；没有待审批项时直接删键，避免留空壳占用存储。 */
function persistQueue(key: string, queue: PendingToolAction[]): void {
  const store = getScopedStorage(PENDING_STORAGE_PREFIX);
  if (!store) return;
  const pending = queue.filter((item) => item.status === "pending");
  try {
    if (pending.length === 0) {
      store.remove(key);
      return;
    }
    const snapshot: StoredAction[] = pending.map((item) => ({
      id: item.id,
      toolName: item.toolName,
      label: item.label,
      args: item.args,
      error: item.error,
    }));
    store.set(key, JSON.stringify(snapshot));
  } catch {
    // 配额满或隐私模式：丢失持久化不影响本轮审批。
  }
}

/** 生成队列键；老调用方不传 sessionId 时用空串，保持兼容。 */
function scopeKey(ctx: ToolContext): string {
  return `${ctx.projectId}::${ctx.sessionId ?? ""}`;
}

/** 取（必要时创建）当前上下文的队列；首次访问时从本地快照恢复。 */
function queueOf(ctx: ToolContext): PendingToolAction[] {
  const key = scopeKey(ctx);
  let queue = pendingByScope.get(key);
  if (!queue) {
    queue = readStored(key)
      .map((item): PendingToolAction | null => {
        const tool = findTool(item.toolName);
        // 工具可能在版本升级后被移除；这类旧卡片直接丢弃，不能留下点不动的僵尸审批。
        if (tool?.risk !== "write") return null;
        const args = scrubArgs(item.args) as Record<string, unknown>;
        return {
          id: item.id,
          toolName: item.toolName,
          label: item.label,
          args,
          preview: buildWritePreview(item.toolName, args),
          tool,
          status: "pending",
          error: item.error,
        };
      })
      .filter((item): item is PendingToolAction => item !== null);
    pendingByScope.set(key, queue);
  }
  return queue;
}

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

/** 给模型的待审批提示：结果会以工具回执进入对话，模型在下一轮能据此继续推理。 */
function approvalPrompt(action: PendingToolAction): string {
  return `工具 ${action.toolName} 已提交作者审批，当前未执行。作者通过或驳回后，结果会以「工具回执」出现在对话中；请基于已有信息继续或结束回答，不要假设它已经执行。`;
}

/**
 * 执行一批工具调用，返回与之一一对应的观察结果（供下一轮请求作为 tool 消息）。
 *
 * `allowedToolNames` 是本轮生效的角色白名单：只裁剪下发定义不够，JSON 降级轨
 * 可以凭空写出任意工具名，执行前必须按同一份白名单再拦一次。
 */
export async function executeCalls(
  calls: CollectedToolCall[],
  ctx: ToolContext,
  allowedToolNames: string[] = [],
): Promise<ToolObservation[]> {
  const allowed = allowedToolNames.length > 0 ? new Set(allowedToolNames) : null;
  const results: ToolObservation[] = [];
  for (const call of calls) {
    results.push(await executeOne(call, ctx, allowed));
  }
  return results;
}

/** 执行单个调用：解析错误/未授权/未知工具/校验失败都转成 isError 观察，不中断整批。 */
async function executeOne(
  call: CollectedToolCall,
  ctx: ToolContext,
  allowed: Set<string> | null,
): Promise<ToolObservation> {
  const base = { toolCallId: call.id, toolName: call.name };
  if (call.parseError) {
    return { ...base, content: call.parseError, isError: true };
  }
  if (allowed && !allowed.has(call.name)) {
    return {
      ...base,
      content: `工具 ${call.name} 不在当前角色允许的工具列表中，已拒绝执行。`,
      isError: true,
    };
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
    // 脱敏必须在入队时做：审批通过后执行的是这份参数，真正写进正文的内容才不会带凭据。
    // 预览同样基于它生成，保证作者「看到的」与「写入的」是同一份文字。
    const args = scrubArgs(call.arguments) as Record<string, unknown>;
    const action: PendingToolAction = {
      // 审批 id 不能采信模型给的 call.id：重复 id 会让后一个动作覆盖前一个，
      // 模型也能猜中别人的 id 去错批。本地生成保证唯一，call.id 仍用于工具回执配对。
      id: `pending-${++pendingSeq}-${Date.now().toString(36)}`,
      toolName: call.name,
      label: describeAction({ ...call, arguments: args }),
      args,
      preview: buildWritePreview(call.name, args),
      tool,
      status: "pending",
      error: "",
    };
    const queue = queueOf(ctx);
    queue.push(action);
    persistQueue(scopeKey(ctx), queue);
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

/** 返回当前上下文队列的副本（UI 只读展示，改动必须走 approve/reject）。 */
export function listPending(ctx: ToolContext): PendingToolAction[] {
  return queueOf(ctx).map((item) => ({ ...item }));
}

/**
 * 审批通过：执行工具的 run，结果由调用方（UI）决定如何落到作品里。
 *
 * 先落到 approved 再执行：工具可能要写库而耗时，也可能抛错——
 * 「作者已批准」与「修改真的落地」是两件事，失败时作者需要看到区分。
 * args 在入队时已脱敏，这里原样执行；不能再脱敏一次结果文案，那样只会改卡片不改正文。
 */
export async function approveAction(
  id: string,
  ctx: ToolContext,
): Promise<PendingToolAction | null> {
  const queue = queueOf(ctx);
  const action = queue.find((item) => item.id === id);
  if (action?.status !== "pending") return null;
  action.status = "approved";
  try {
    // 审批通过后返回的结果会展示到卡片上，同样要脱敏。
    const result = scrubText(await action.tool.run(action.args, ctx));
    action.status = "applied";
    action.error = "";
    // 已批准的动作不再持久化：重启后回执无处可回灌，留着只会变成僵尸审批。
    persistQueue(scopeKey(ctx), queue);
    return { ...action, label: result };
  } catch (err) {
    action.status = "failed";
    action.error = String(err);
    persistQueue(scopeKey(ctx), queue);
    return { ...action };
  }
}

/** 驳回：不执行，标记状态供 UI 显示「已驳回」。 */
export function rejectAction(id: string, ctx: ToolContext): PendingToolAction | null {
  const action = queueOf(ctx).find((item) => item.id === id);
  if (action?.status !== "pending") return null;
  action.status = "rejected";
  persistQueue(scopeKey(ctx), queueOf(ctx));
  return { ...action };
}

/**
 * 清空当前上下文里已完成（通过/驳回/失败）的动作，保留 pending 供下次审批。
 *
 * approved 表示「作者已点通过、工具还在执行」，此时清掉会让审批回执丢给模型，
 * 因此只清真正终态的 applied / rejected / failed。
 */
export function clearFinished(ctx: ToolContext): void {
  const queue = queueOf(ctx);
  const finished = new Set(["applied", "rejected", "failed"]);
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (finished.has(queue[i].status)) queue.splice(i, 1);
  }
  persistQueue(scopeKey(ctx), queue);
}

/**
 * 显式作废当前上下文的全部待审批动作。
 *
 * 重启后作者可能已经不记得上一轮留了什么授权，与其给一个含糊的「恢复」状态，
 * 不如让界面提供明确的作废入口；作废后本地快照同步删除。
 */
export function discardPending(ctx: ToolContext): void {
  const key = scopeKey(ctx);
  pendingByScope.delete(key);
  persistQueue(key, []);
}

/** 仅测试用：清空全部上下文的队列与本地快照。 */
export function resetPendingForTest(): void {
  pendingByScope.clear();
  pendingSeq = 0;
  const store = getScopedStorage(PENDING_STORAGE_PREFIX);
  if (!store) return;
  try {
    // keys() 返回的是带前缀的完整键，remove() 接收相对键，先去掉前缀。
    for (const fullKey of store.keys()) {
      store.remove(fullKey.slice(PENDING_STORAGE_PREFIX.length));
    }
  } catch {
    // 测试环境清理失败可忽略，不影响断言。
  }
}
