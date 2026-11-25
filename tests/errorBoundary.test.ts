import { describe, expect, it } from "vitest";
import { describeRenderError } from "@/utils/errorBoundary";
import { BackendError } from "@/utils/errors";

/**
 * 错误边界的文案契约：不管捕获到 Error、后端对象还是 undefined，
 * 降级卡片都必须给出一句人话，并能补一条可操作的建议。
 */
describe("describeRenderError", () => {
  it("保留 Error 的 message，内部错误不追加空建议", () => {
    expect(describeRenderError(new Error("正文格式无法解析"))).toEqual({
      message: "正文格式无法解析",
      hint: "",
    });
  });

  it("后端错误码翻译成下一步建议", () => {
    expect(describeRenderError(new BackendError("数据库读取失败", "db"))).toEqual({
      message: "数据库读取失败",
      hint: "可以重启应用后重试；若持续失败请先备份数据库。",
    });
  });

  it("普通对象里的 code 与 message 同样生效", () => {
    expect(describeRenderError({ code: "network", message: "连接中断" }).hint).toContain(
      "检查模型服务",
    );
  });

  it("字符串与空值不会渲染成 [object Object]", () => {
    expect(describeRenderError("渲染失败").message).toBe("渲染失败");
    expect(describeRenderError(undefined).message).toBe("操作失败");
  });
});
