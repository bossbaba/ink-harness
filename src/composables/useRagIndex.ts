import { computed, ref, watch } from "vue";
import { ragService } from "@/services/ragService";
import type { RagStatus } from "@/types";

export interface RagIndexOptions {
  /**
   * 何时重新读一次状态。写作台传「AI 面板是否展开」：正文一直在落库，
   * 每打开一次面板都该看到最新的「已过期 / 尚未建索引」，而不是进页面时的旧值。
   */
  refreshOn?: () => boolean;
}

/**
 * 某个作品的检索索引状态：给写作台显示「索引 N 段 / 已过期」并触发重建。
 *
 * 状态读失败按「没有索引」处理：写作本身不受影响，只是少了检索增强。
 */
export function useRagIndex(projectId: () => string, options: RagIndexOptions = {}) {
  const status = ref<RagStatus | null>(null);
  const busy = ref(false);
  const error = ref("");

  async function refresh(): Promise<void> {
    const id = projectId();
    if (!id) {
      status.value = null;
      return;
    }
    try {
      const next = await ragService.status(id);
      // 请求发出后用户可能已切到别的作品，旧响应不能覆盖新作品的状态。
      if (projectId() === id) status.value = next;
    } catch {
      if (projectId() === id) status.value = null;
    }
  }

  /** 全量重建：逐条调用 embedding，作品越大越慢，按钮要显示进行中。 */
  async function reindex(): Promise<void> {
    const id = projectId();
    if (!id || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      status.value = await ragService.reindex(id);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  }

  const label = computed(() => {
    const current = status.value;
    if (!current) return "";
    if (current.chunks === 0) {
      return current.embeddingReady ? "尚未建索引" : "未配置检索模型";
    }
    return `索引 ${current.chunks} 段${current.stale ? " · 已过期" : ""}`;
  });

  watch(projectId, () => void refresh(), { immediate: true });

  if (options.refreshOn) {
    watch(options.refreshOn, (active) => {
      if (active) void refresh();
    });
  }

  return { status, busy, error, label, refresh, reindex };
}
