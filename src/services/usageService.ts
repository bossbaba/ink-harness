import { tauriApi } from "@/api/tauri";
import { SETTING_TOKEN_BUDGET, settingsService } from "@/services/settingsService";
import type { ProviderConfig, UsageStats } from "@/types";

/** 读取看板数据。token 由 Rust 在流式响应末尾解析并写入。 */
export function getUsageStats(): Promise<UsageStats> {
  return tauriApi.usageStats();
}

export async function getTokenBudget(): Promise<number> {
  const raw = await settingsService.getString(SETTING_TOKEN_BUDGET);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function setTokenBudget(value: number): Promise<void> {
  await settingsService.setString(SETTING_TOKEN_BUDGET, String(Math.max(0, value)));
}

/**
 * 按各模型当时的单价估算费用。
 * 单价是配置项，改价不该回头改写历史，所以这里只做展示用估算，不入库。
 */
export function estimateCost(stats: UsageStats, providers: ProviderConfig[]): number {
  let cost = 0;
  for (const entry of stats.byModel) {
    const separator = entry.model.indexOf(":");
    if (separator < 0) continue;
    const providerId = entry.model.slice(0, separator);
    const modelId = entry.model.slice(separator + 1);
    const rate = providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId)?.costPer1kTokens;
    if (!rate) continue;
    cost += (rate * entry.tokens) / 1000;
  }
  return cost;
}
