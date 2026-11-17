import { tauriApi } from "@/api/tauri";
import type {
  ChatChunk,
  ChatMessage,
  ModelInfo,
  PrivacyScope,
  RouteStrategy,
  TaskKind,
} from "@/types";

/**
 * 任务 → 模型偏好。实际选择由可用 Provider 与策略共同决定。
 * 仅表达偏好，不绑定具体模型 id（模型是配置项）。
 */
const TASK_PREFERENCE: Record<TaskKind, { quality: number; preferLocal: boolean }> = {
  ideation: { quality: 0, preferLocal: true },
  continue: { quality: 1, preferLocal: false },
  rewrite: { quality: 1, preferLocal: false },
  expand: { quality: 1, preferLocal: false },
  polish: { quality: 2, preferLocal: false },
  review: { quality: 3, preferLocal: false },
  summary: { quality: 0, preferLocal: true },
};

export interface RouteContext {
  task: TaskKind;
  strategy: RouteStrategy;
  /** 作品隐私范围；local-only 时强制本地模型。 */
  privacy: PrivacyScope;
  /** 本任务需要的上下文窗口下限（token）。 */
  minContext?: number;
}

export interface ChatStreamHandle {
  /** 等待本次流式请求结束。 */
  done: Promise<void>;
}

class ModelRouterImpl {
  private providers: Awaited<ReturnType<typeof tauriApi.listProviders>> = [];

  async refresh(): Promise<void> {
    this.providers = await tauriApi.listProviders();
  }

  /** 按任务与策略选模型；隐私 local-only 时只考虑本地 source。 */
  select(ctx: RouteContext): ModelInfo | null {
    const pref = TASK_PREFERENCE[ctx.task];
    const localOnly = ctx.privacy === "local-only";
    const candidates = this.providers
      .filter((p) => p.enabled)
      .filter((p) => !localOnly || p.source === "local")
      .flatMap((p) => p.models);

    if (candidates.length === 0) return null;

    const scored = candidates
      .filter((m) => !ctx.minContext || m.capabilities.contextWindow >= ctx.minContext)
      .map((m) => {
        const q = Math.min(3, Math.max(0, Math.round(m.capabilities.contextWindow / 8192)));
        let score = ctx.strategy === "quality" ? q : ctx.strategy === "cost" ? -q : 0;
        if (ctx.strategy === "privacy") {
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
      },
      onChunk,
      onError,
    );
    return { done };
  }
}

export const modelRouter = new ModelRouterImpl();
