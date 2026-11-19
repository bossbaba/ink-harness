import { describe, expect, it } from "vitest";
import { diffText } from "@/utils/textDiff";

/** 审稿 Diff 的 LCS 对比：锁住中文不拆字、相邻同类合并、超长整段替换三条规则。 */
describe("diffText", () => {
  it("相同文本只有 equal 段", () => {
    expect(diffText("你好", "你好")).toEqual([{ kind: "equal", text: "你好" }]);
  });

  it("中间替换生成 del + equal + add", () => {
    expect(diffText("我爱吃苹果", "我爱吃香蕉")).toEqual([
      { kind: "equal", text: "我爱吃" },
      { kind: "del", text: "苹果" },
      { kind: "add", text: "香蕉" },
    ]);
  });

  it("中文按码点切分，不拆成半个 UTF-16", () => {
    const segments = diffText("一个😀表情", "一个🥰表情");
    expect(segments.some((s) => s.text.includes("😀"))).toBe(true);
    expect(segments.some((s) => s.text.includes("🥰"))).toBe(true);
  });

  it("纯新增与纯删除", () => {
    expect(diffText("", "新增")).toEqual([{ kind: "add", text: "新增" }]);
    expect(diffText("删除", "")).toEqual([{ kind: "del", text: "删除" }]);
  });

  it("超过上限时整段替换，不做逐字比对", () => {
    const long = "字".repeat(700);
    const segments = diffText(long, "短");
    expect(segments).toEqual([
      { kind: "del", text: long },
      { kind: "add", text: "短" },
    ]);
  });
});
