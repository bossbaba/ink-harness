import { ref, type Ref } from "vue";
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
 * ctx 由调用方注入（项目/章节 id），这里不直接读全局 store。
 */
export function useAgentActions(ctx: () => ToolContext) {
  const pending: Ref<PendingToolAction[]> = ref(listPending());
  const busyId = ref("");
  const error = ref("");

  /** 每次工具执行后调用，把执行器队列的最新状态同步到界面。 */
  function refresh(): void {
    pending.value = listPending();
  }

  async function approve(id: string): Promise<string> {
    busyId.value = id;
    error.value = "";
    try {
      const action = await approveAction(id, ctx());
      refresh();
      // 通过的写工具返回的是「工具结果文本」，供 UI 决定插入正文；失败时为空。
      return action?.status === "applied" ? action.label : "";
    } catch (err) {
      error.value = `执行操作失败：${String(err)}`;
      refresh();
      return "";
    } finally {
      busyId.value = "";
    }
  }

  function reject(id: string): void {
    rejectAction(id);
    refresh();
  }

  function clear(): void {
    clearFinished();
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
