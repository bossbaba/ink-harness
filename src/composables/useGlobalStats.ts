import { ref } from "vue";
import { tauriApi } from "@/api/tauri";
import { getTokenBudget, getUsageStats, setTokenBudget } from "@/services/usageService";
import type { ProviderConfig, UsageStats, WorkspaceStats } from "@/types";

/**
 * 全局统计页状态：作品/章节/字数汇总 + token 用量 + Provider 列表（给成本估算用）。
 * 页面只读，三个请求互不依赖，失败各自兜底，不让一块数据挂掉整页。
 */
export function useGlobalStats() {
  const loading = ref(false);
  const stats = ref<WorkspaceStats | null>(null);
  const usage = ref<UsageStats | null>(null);
  const providers = ref<ProviderConfig[]>([]);
  const budget = ref(0);
  const error = ref("");

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      const [workspace, usageStats, list, tokenBudget] = await Promise.all([
        tauriApi.workspaceStats(),
        getUsageStats().catch(() => null),
        tauriApi.listProviders().catch(() => [] as ProviderConfig[]),
        getTokenBudget().catch(() => 0),
      ]);
      stats.value = workspace;
      usage.value = usageStats;
      providers.value = list;
      budget.value = tokenBudget;
    } catch (err) {
      error.value = `读取统计失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 月度预算是全局设置，复用模型管理页的 setter，改完立即回写。 */
  async function updateBudget(value: number): Promise<void> {
    budget.value = value;
    await setTokenBudget(value);
  }

  return { loading, stats, usage, providers, budget, error, load, updateBudget };
}
