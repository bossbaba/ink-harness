import { computed, ref } from "vue";
import { agentSessionService } from "@/services/agentSessionService";
import { providerService } from "@/services/providerService";
import { statsService } from "@/services/statsService";
import {
  estimateCost,
  getTokenBudget,
  getUsageStats,
  setTokenBudget,
} from "@/services/usageService";
import type {
  AgentSession,
  AgentStepRecord,
  ProviderConfig,
  UsageStats,
  WorkspaceStats,
} from "@/types";

/**
 * 全局统计页状态：作品/章节/字数汇总 + token 用量 + Provider 列表（给成本估算用）。
 * 页面只读，几个请求互不依赖，失败各自兜底，不让一块数据挂掉整页。
 */
export function useGlobalStats() {
  const loading = ref(false);
  const stats = ref<WorkspaceStats | null>(null);
  const usage = ref<UsageStats | null>(null);
  const providers = ref<ProviderConfig[]>([]);
  const budget = ref(0);
  const error = ref("");
  /** Agent 会话与轨迹：全局视角传空 projectId 拉全部。 */
  const agentSessions = ref<AgentSession[]>([]);
  const agentSteps = ref<AgentStepRecord[]>([]);

  // 费用是 usage + providers 的纯派生值，放在 composable 里算好，
  // 展示组件只收款项，不自行调用 service（遵循「组件只收 props / emit」的分层约定）。
  const cost = computed(() => (usage.value ? estimateCost(usage.value, providers.value) : 0));

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    // 单个请求失败不能拖垮整页，但也不能静默降级成 0：
    // 看板显示 0 与「真的没有数据」无法区分，所以把失败项收集起来统一提示。
    const failures: string[] = [];
    try {
      const [workspace, usageStats, list, tokenBudget, sessions, steps] = await Promise.all([
        statsService.workspace().catch((err: unknown) => {
          failures.push(`作品统计（${String(err)}）`);
          return null;
        }),
        getUsageStats().catch((err: unknown) => {
          failures.push(`token 用量（${String(err)}）`);
          return null;
        }),
        providerService.list().catch((err: unknown) => {
          failures.push(`模型配置（${String(err)}）`);
          return [] as ProviderConfig[];
        }),
        getTokenBudget().catch((err: unknown) => {
          failures.push(`预算设置（${String(err)}）`);
          return 0;
        }),
        agentSessionService.list("").catch((err: unknown) => {
          failures.push(`Agent 会话（${String(err)}）`);
          return [] as AgentSession[];
        }),
        agentSessionService.listSteps("").catch((err: unknown) => {
          failures.push(`Agent 轨迹（${String(err)}）`);
          return [] as AgentStepRecord[];
        }),
      ]);
      stats.value = workspace;
      usage.value = usageStats;
      providers.value = list;
      budget.value = tokenBudget;
      agentSessions.value = sessions;
      agentSteps.value = steps;
      if (failures.length > 0) {
        error.value = `部分数据读取失败，页面数字可能不完整：${failures.join("、")}`;
      }
    } catch (err) {
      error.value = `读取统计失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 月度预算是全局设置，写失败要回滚界面值，避免显示一个重启后就丢失的预算。 */
  async function updateBudget(value: number): Promise<void> {
    const previous = budget.value;
    budget.value = value;
    try {
      await setTokenBudget(value);
    } catch (err) {
      budget.value = previous;
      error.value = `保存预算失败：${String(err)}`;
    }
  }

  return {
    loading,
    stats,
    usage,
    providers,
    budget,
    cost,
    error,
    agentSessions,
    agentSteps,
    load,
    updateBudget,
  };
}
