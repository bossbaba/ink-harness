import { ref } from "vue";
import { normalizeError } from "@/utils/errors";

/**
 * 全局提示栈：给「没有人负责展示」的错误兜底。
 *
 * 页面自己的 error ref 仍然优先（位置更贴近操作），但这个栈保证：
 * 事件处理器里抛的错、`void somePromise()` 的 rejection、`app.config.errorHandler`
 * 收到的异常，都不会只躺在控制台里。
 */
export interface NoticeItem {
  id: number;
  level: "error" | "info";
  message: string;
}

/** 同时最多显示几条，避免批量失败时刷屏遮住界面。 */
const MAX_VISIBLE = 4;
/** 自动消失时间：错误需要读完，所以给到 8 秒，也允许手动关闭。 */
const AUTO_DISMISS_MS = 8000;

const notices = ref<NoticeItem[]>([]);
let seq = 0;

function dismiss(id: number): void {
  notices.value = notices.value.filter((item) => item.id !== id);
}

function push(message: string, level: NoticeItem["level"] = "error"): void {
  const text = message.trim();
  if (!text) return;
  // 同一句话在短时间内重复出现（如连续两次自动保存失败）只保留一条。
  if (notices.value.some((item) => item.message === text)) return;
  seq += 1;
  const item: NoticeItem = { id: seq, level, message: text };
  notices.value = [...notices.value, item].slice(-MAX_VISIBLE);
  window.setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
}

/**
 * 任意位置上报错误。带 `prefix` 时拼成「前缀：原因」，用来告诉用户是哪一步失败的。
 * 提示栈本身不抛错，可以放心在 catch 里直接调用。
 */
export function notifyError(err: unknown, prefix = ""): void {
  const { code, message } = normalizeError(err);
  const hint = code === "internal" || code === "validation" ? "" : message;
  const detail = hint || message;
  push(prefix ? `${prefix}：${detail}` : detail);
}

/** 普通信息提示（如「已导出到…」），不参与错误统计。 */
export function notifyInfo(message: string): void {
  push(message, "info");
}

export function useNotice() {
  return { notices, push, dismiss };
}
