import { errorHint, normalizeError } from "@/utils/errors";

/**
 * 错误边界展示层专用的错误描述。
 *
 * 组件捕获到的值不一定是 Error：可能是后端 `{code,message}`、字符串，甚至 undefined。
 * 这里统一收敛成「失败原因 + 下一步建议」两段文案，保证降级卡片不会出现
 * `Error: [object Object]` 这种只能给开发者看的内容。
 */
export interface RenderErrorDetail {
  /** 一句话说明刚刚发生了什么，来自后端文案或异常 message。 */
  message: string;
  /** 告诉作者接下来怎么做；没有可操作建议时为空串。 */
  hint: string;
}

/** 把任意捕获值转成可直接渲染的降级文案。 */
export function describeRenderError(raw: unknown): RenderErrorDetail {
  const { code, message } = normalizeError(raw);
  return { message, hint: errorHint(code) };
}
