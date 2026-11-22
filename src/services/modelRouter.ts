import { shallowRef } from "vue";
import { tauriApi } from "@/api/tauri";
import {
  SETTING_DEFAULT_MODEL,
  SETTING_ROUTE_STRATEGY,
  settingsService,
} from "@/services/settingsService";
import type {
  ChatChunk,
  ChatMessage,
  ModelInfo,
  PrivacyScope,
  ProviderConfig,
  ProviderModel,
  RouteStrategy,
  TaskKind,
  ToolDefinition,
} from "@/types";

/**
 * 把 Provider 下配置的模型映射成路由用的 ModelInfo。
 * tools 来自模型管理页的显式勾选，未勾选的模型在 Agent Loop 里走 JSON 降级轨。
 */
export function toModelInfo(provider: ProviderConfig, model: ProviderModel): ModelInfo {
  return {
    id: model.id,
    provider: provider.id,
    source: provider.source,
    displayName: model.displayName || model.id,
    capabilities: {
      contextWindow: model.contextWindow,
      tools: model.supportsTools === true,
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
  /** 作者指定的默认模型标识 `providerId:modelId`；空串表示未设置，退回策略打分。 */
  private defaultModelRef = "";

  /**
   * 当前生效的生成模型，供顶栏等界面展示「正在用哪个模型」。
   * 用 shallowRef 让配置/Provider 变化后界面自动更新，不必各页面各自刷新。
   */
  readonly currentModel = shallowRef<ModelInfo | null>(null);

  async refresh(): Promise<void> {
    const [providers, strategy, defaultModel] = await Promise.all([
      tauriApi.listProviders(),
      settingsService.getString(SETTING_ROUTE_STRATEGY),
      settingsService.getString(SETTING_DEFAULT_MODEL),
    ]);
    this.providers = providers;
    if (strategy === "quality" || strategy === "cost" || strategy === "privacy") {
      this.strategy = strategy;
    }
    this.defaultModelRef = defaultModel;
    this.updateCurrentModel();
  }

  getStrategy(): RouteStrategy {
    return this.strategy;
  }

  /** 当前默认模型标识，空串表示未设置（用于设置页回显下拉框）。 */
  getDefaultModel(): string {
    return this.defaultModelRef;
  }

  /** 改策略先落库再改内存，保证后续请求（含缓存页面）都用到新值。 */
  async setStrategy(value: RouteStrategy): Promise<void> {
    await settingsService.setString(SETTING_ROUTE_STRATEGY, value);
    this.strategy = value;
    this.updateCurrentModel();
  }

  /**
   * 设置默认生成模型。先落库再改内存，界面上的「当前模型」随之更新。
   * 传空串表示清除默认、退回按策略自动选。
   */
  async setDefaultModel(value: string): Promise<void> {
    await settingsService.setString(SETTING_DEFAULT_MODEL, value);
    this.defaultModelRef = value;
    this.updateCurrentModel();
  }

  /**
   * 用一次中性上下文（copilot / any）算出「当前模型」供展示。
   * 统一复用 select()，保证顶栏显示的和 AI 实际选到的是同一套逻辑。
   */
  private updateCurrentModel(): void {
    this.currentModel.value = this.select({ task: "copilot", privacy: "any" });
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

    // 作者指定了默认模型时优先用它，不再按策略打分；但要满足本次隐私与上下文约束。
    // 若该模型已被删除/停用或不符合约束，则自然回落到下面的策略打分，避免请求失败。
    if (this.defaultModelRef) {
      const preset = candidates.find((m) => `${m.provider}:${m.id}` === this.defaultModelRef);
      if (preset && (!ctx.minContext || preset.capabilities.contextWindow >= ctx.minContext)) {
        return preset;
      }
    }

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

  /**
   * 发起流式对话。返回 Promise，逐块通过 onChunk 回调。
   * tools 非空时随请求透传给上游；是否真的启用取决于 select 选到的模型 capabilities.tools。
   * `toolChoice=required` 用于首轮取数：小模型常无视提示直接编答案，强制它先调一次工具。
   */
  chat(
    ctx: RouteContext,
    messages: ChatMessage[],
    onChunk: (chunk: ChatChunk) => void,
    onError?: (error: string) => void,
    tools?: ToolDefinition[],
    toolChoice?: "auto" | "required",
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
        // 只有声明支持工具调用的模型才下发 tools，避免不支持的模型收到参数后行为异常。
        tools: model.capabilities.tools ? tools : undefined,
        // tool_choice 跟着 tools 走：没有工具却要求 required，上游会直接 400。
        toolChoice: model.capabilities.tools ? toolChoice : undefined,
      },
      onChunk,
      onError,
    );
    return { done };
  }
}

export const modelRouter = new ModelRouterImpl();
