/**
 * 错误归一化：后端现在返回 `{ code, message }`，但历史调用点还有
 * `throw new Error(...)`、字符串、甚至 `undefined`。全部收敛到这里，
 * 页面只消费 `{ code, message }`，不再各自写一套 `String(err)`。
 */

/** 后端错误码（与 src-tauri/src/error.rs 的 ErrorCode 保持一致）。 */
export type ErrorCode =
  | "validation"
  | "not_found"
  | "conflict"
  | "db"
  | "network"
  | "upstream"
  | "internal";

export interface NormalizedError {
  code: ErrorCode;
  message: string;
}

/**
 * 后端文案已经可读，这里只补「接下来该做什么」。
 * 返回空串表示直接用后端文案，避免同一句话出现两遍。
 */
export function errorHint(code: ErrorCode): string {
  switch (code) {
    case "network":
      return "检查模型服务是否已启动、地址是否可达。";
    case "upstream":
      return "稍后再试，或换一个模型。";
    case "db":
      return "可以重启应用后重试；若持续失败请先备份数据库。";
    case "not_found":
      return "刷新页面后再试。";
    case "conflict":
      return "刷新后再操作。";
    default:
      return "";
  }
}

/** 归一成 `{ code, message }`；无法识别时按 internal 处理，绝不返回值丢失的空错误。 */
export function normalizeError(raw: unknown): NormalizedError {
  if (raw instanceof BackendError) {
    return { code: raw.code, message: raw.message };
  }
  if (raw instanceof Error) {
    return { code: "internal", message: raw.message || "操作失败" };
  }
  if (typeof raw === "string") {
    return { code: "internal", message: raw };
  }
  if (raw && typeof raw === "object") {
    const value = raw as { code?: unknown; message?: unknown };
    const message = typeof value.message === "string" ? value.message : "操作失败";
    const code = typeof value.code === "string" ? (value.code as ErrorCode) : "internal";
    return { code, message };
  }
  return { code: "internal", message: "操作失败" };
}

/**
 * 后端错误的 JS 表示。
 * `toString()` 只返回 message：页面里大量 `String(err)` 的展示不会被加上
 * 「Error: / BackendError: 」前缀，也不用逐个改。
 */
export class BackendError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = "internal") {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }

  override toString(): string {
    return this.message;
  }
}
