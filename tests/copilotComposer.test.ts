import { describe, expect, it } from "vitest";
import { detectTrigger } from "@/utils/copilotComposer";

/**
 * 这段判定的两个失效方向都会直接影响输入体验：
 * 该触发不触发 = 打 @ / 没反应；不该触发却触发 = 打邮箱或链接时弹窗抢焦点。
 */
describe("detectTrigger", () => {
  it("空输入框打 @ 会触发，并把它从草稿里摘掉", () => {
    expect(detectTrigger("", "@", "@")).toEqual({ index: 0, draft: "" });
  });

  it("中文与空白之后打 @ 都触发", () => {
    expect(detectTrigger("你好", "你好@", "@")).toEqual({ index: 2, draft: "你好" });
    expect(detectTrigger("看下 ", "看下 @", "@")).toEqual({ index: 3, draft: "看下 " });
  });

  it("邮箱、@用户名这类紧贴字母数字的写法不触发", () => {
    expect(detectTrigger("name", "name@", "@")).toBeNull();
    expect(detectTrigger("user.", "user.@", "@")).toBeNull();
  });

  it("粘贴或输入法整串上屏不触发", () => {
    expect(detectTrigger("", "@张三", "@")).toBeNull();
    expect(detectTrigger("你好", "你好，@", "@")).toBeNull();
  });

  it("在中间插入 @ 时按位置摘掉，前后文本保持不变", () => {
    expect(detectTrigger("你好世界", "你好@世界", "@")).toEqual({ index: 2, draft: "你好世界" });
  });

  it("选区替换成 @ 不算纯插入", () => {
    expect(detectTrigger("abc", "a@", "@")).toBeNull();
  });

  it("打 / 会触发 Agent 菜单", () => {
    expect(detectTrigger("", "/", "/")).toEqual({ index: 0, draft: "" });
    expect(detectTrigger("用一下", "用一下/", "/")).toEqual({ index: 3, draft: "用一下" });
  });

  it("协议头与路径里的斜杠不触发", () => {
    expect(detectTrigger("http:", "http:/", "/")).toBeNull();
    expect(detectTrigger("a/", "a//", "/")).toBeNull();
  });
});
