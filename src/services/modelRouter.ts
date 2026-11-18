import { tauriApi } from "@/api/tauri";
import { SETTING_ROUTE_STRATEGY, settingsService } from "@/services/settingsService";
import type {
  ChatChunk,
  ChatMessage,
  ModelInfo,
  PrivacyScope,
  ProviderConfig,
  ProviderModel,
  RouteStrategy,
  TaskKind,
} from "@/types";

/**
 * 把 Provider 下配置的模型映射成路由用的 ModelInfo。
 * tools/json/vision 暂未在模型管理里采集，先按 false 处理，接入对应能力时再补。
 */
export function toModelInfo(provider: ProviderConfig, model: ProviderModel): ModelInfo {
  return {
    id: model.id,
    provider: provider.id,
    source: provider.source,
    displayName: model.displayName || model.id,
    capabilities: {
      contextWindow: model.contextWindow,
      tools: false,
      json: false,
      vision: false,
      streaming: true,
    },
    costPer1kTokens: model.costPer1kTokens,
  };
}

/**
 * 任务 → 模型偏好。实际选择由可用 Provider 与策略共同决定。
 * 仅表达偏好，不绑定具体模型 id（模型是配置项）。
 */
const TASK_PREFERENCE: Record<TaskKind, { quality: number; preferLocal: boolean }> = {
  ideation: { quality: 0, preferLocal: true },
  // 对话式 Copilot 要接得住长上下文，比续写更依赖模型质量，但仍优先本地模型省钱。
  copilot: { quality: 1, preferLocal: true },
  continue: { quality: 1, preferLocal: false },
  rewrite: { quality: 1, preferLocal: false },
  expand: { quality: 1, preferLocal: false },
  condense: { quality: 1, preferLocal: false },
  polish: { quality: 2, preferLocal: false },
  review: { quality: 3, preferLocal: false },
  // 发布物料是一次性营销文案，质量优先，但不像审稿那样必须最强模型。
  publish: { quality: 2, preferLocal: true },
  summary: { quality: 0, preferLocal: true },
};

export interface RouteContext {
  task: TaskKind;
  /** 不传就用模型管理页选定的全局策略，避免每个调用点各写一套。 */
  strategy?: RouteStrategy;
  /** 作品隐私范围；local-only 时强制本地模型。 */
  privacy: PrivacyScope;
  /** 本任务需要的上下文窗口下限（token）。 */
  minContext?: number;
  /** 作品 ID，只用于把本次 token 用量记到该作品名下。 */
  projectId?: string;
}

export interface ChatStreamHandle {
  /** 等待本次流式请求结束。 */
  done: Promise<void>;
}

class ModelRouterImpl {
  private providers: Awaited<ReturnType<typeof tauriApi.listProviders>> = [];
  private strategy: RouteStrategy = "quality";

  async refresh(): Promise<void> {
    const [providers, strategy] = await Promise.all([
      tauriApi.listProviders(),
      settingsService.getString(SETTING_ROUTE_STRATEGY),
    ]);
    this.providers = providers;
    if (strategy === "quality" || strategy === "cost" || strategy === "privacy") {
      this.strategy = strategy;
    }
  }

  getStrategy(): RouteStrategy {
    return this.strategy;
  }

  /** 改策略先落库再改内存，保证后续请求（含缓存页面）都用到新值。 */
  async setStrategy(value: RouteStrategy): Promise<void> {
    await settingsService.setString(SETTING_ROUTE_STRATEGY, value);
    this.strategy = value;
  }

  /** 按任务与策略选模型；隐私 local-only 时只考虑本地 source。 */
  select(ctx: RouteContext): ModelInfo | null {
    const strategy = ctx.strategy ?? this.strategy;
    const pref = TASK_PREFERENCE[ctx.task];
    const localOnly = ctx.privacy === "local-only";
    const candidates = this.providers
      .filter((p) => p.enabled)
      .filter((p) => !localOnly || p.source === "local")
      .flatMap((p) => p.models.map((model) => toModelInfo(p, model)));

    if (candidates.length === 0) return null;

    const scored = candidates
      .filter((m) => !ctx.minContext || m.capabilities.contextWindow >= ctx.minContext)
      .map((m) => {
        const q = Math.min(3, Math.max(0, Math.round(m.capabilities.contextWindow / 8192)));
        let score = strategy === "quality" ? q : strategy === "cost" ? -q : 0;
        if (strategy === "privacy") {
          score += m.source === "local" ? 2 : 0;
        } else if (pref.preferLocal && m.source === "local") {
          score += 1;
        }
        return { model: m, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.model ?? candidates[0] ?? null;
  }

  /** 发起流式对话。返回 Promise，逐块通过 onChunk 回调。 */
  chat(
    ctx: RouteContext,
    messages: ChatMessage[],
    onChunk: (chunk: ChatChunk) => void,
    onError?: (error: string) => void,
  ): ChatStreamHandle {
    const model = this.select(ctx);
    if (!model) {
      const msg = "没有可用模型，请先在模型管理中配置 Provider";
      onError?.(msg);
      return { done: Promise.reject(new Error(msg)) };
    }
    if (ctx.privacy === "local-only" && model.source !== "local") {
      const msg = "隐私约束：该作品仅允许本地模型";
      onError?.(msg);
      return { done: Promise.reject(new Error(msg)) };
    }

    const done = tauriApi.chat(
      {
        model: `${model.provider}:${model.id}`,
        messages,
        privacyLocalOnly: ctx.privacy === "local-only",
        taskKind: ctx.task,
        projectId: ctx.projectId,
      },
      onChunk,
      onError,
    );
    return { done };
  }
}

export const modelRouter = new ModelRouterImpl();
