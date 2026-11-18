import { modelRouter } from "@/services/modelRouter";
import type { ChatMessage, PrivacyScope, TaskKind } from "@/types";

/**
 * 流式对话的统一入口。
 *
 * 之前每个业务服务（摘要/工作流/出版简报/审稿/AI 辅助/对话）都自己写一遍
 * 「refresh → select → chat → await done → 判空」，样板重复，且错误口径不一致：
 * 有的把真实原因（网络、鉴权、配额）吞掉，只剩一句「模型没有返回内容」。
 * 现在统一收在这里，调用方只关心「拿到全文」和「失败原因」。
 */

/** 没有可用模型时的统一文案；六处服务原本各写一句，措辞还不一样。 */
export const NO_MODEL_MESSAGE = "没有可用模型，请先在模型管理里配置并启用 Provider。";

/** 模型返回空内容时的统一文案。 */
export const EMPTY_REPLY_MESSAGE = "模型没有返回内容，可以再试一次。";

export interface ChatRoute {
  task: TaskKind;
  privacy: PrivacyScope;
  projectId?: string;
}

export interface ChatRunResult {
  /** 累计收到的全文（已拼接增量）。 */
  raw: string;
  /** 失败原因；为空表示流正常结束。 */
  failure: string;
}

/**
 * 跑一次流式对话。
 *
 * - 先 `refresh()` 再 `select()`：模型管理页刚改过配置时也能选到新 Provider；
 * - 失败原因由 `onError` 收集到 `failure` 返回，而不是在这里抛，
 *   这样调用方可以先做自己的兜底（比如判空、降级）再抛出带上下文的文案；
 * - `done` 只可能在「无可用模型 / 隐私拦截」时 reject，且那两种情况已经走过
 *   `onError`，所以这里的 catch 只是防止 unhandled rejection。
 */
export async function runChat(
  route: ChatRoute,
  messages: ChatMessage[],
  onProgress?: (received: number) => void,
): Promise<ChatRunResult> {
  await modelRouter.refresh();
  if (!modelRouter.select(route)) {
    return { raw: "", failure: NO_MODEL_MESSAGE };
  }

  let raw = "";
  let failure = "";
  const handle = modelRouter.chat(
    route,
    messages,
    (chunk) => {
      if (!chunk.delta) return;
      raw += chunk.delta;
      onProgress?.(raw.length);
    },
    (message) => {
      failure = message;
    },
  );
  await handle.done.catch(() => undefined);
  return { raw, failure };
}
