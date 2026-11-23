import { type Ref, ref } from "vue";
import {
  approveAction,
  clearFinished,
  listPending,
  rejectAction,
  resetPendingForTest,
} from "@/services/actionExecutor";
import type { PendingToolAction, ToolContext } from "@/types";

/**
 * Agent 动作审批：把执行器里的待审批队列映射成 Vue 响应式状态，
 * 供 Copilot 面板显示「待授权操作」卡片。
 *
 * 执行器保持纯 TS（便于单测），响应式只在这一层引入；
 * ctx 由调用方以 getter 注入，每次操作都重新取，切作品/会话后不会用旧上下文。
 */
export function useAgentActions(ctx: () => ToolContext) {
  const pending: Ref<PendingToolAction[]> = ref(listPending(ctx()));
  const busyId = ref("");
  const error = ref("");

  /** 每次工具执行或审批后调用，把当前上下文队列的最新状态同步到界面。 */
  function refresh(): void {
    pending.value = listPending(ctx());
  }

  /**
   * 审批通过。返回完整的动作（含最终状态与结果文本），
   * 由调用方决定是否把结果作为工具回执写回对话。
   */
  async function approve(id: string): Promise<PendingToolAction | null> {
    busyId.value = id;
    error.value = "";
    try {
      const action = await approveAction(id, ctx());
      refresh();
      return action;
    } catch (err) {
      error.value = `执行操作失败：${String(err)}`;
      refresh();
      return null;
    } finally {
      busyId.value = "";
    }
  }

  /** 驳回：同样返回动作，便于把「作者已驳回」回灌给模型。 */
  function reject(id: string): PendingToolAction | null {
    const action = rejectAction(id, ctx());
    refresh();
    return action;
  }

  function clear(): void {
    clearFinished(ctx());
    refresh();
  }

  function reset(): void {
    resetPendingForTest();
    refresh();
  }

  /** 当前是否有待作者审批的操作。 */
  const hasPending = () => pending.value.some((item) => item.status === "pending");

  return { pending, busyId, error, hasPending, refresh, approve, reject, clear, reset };
}
