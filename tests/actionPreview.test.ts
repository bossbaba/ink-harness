import { describe, expect, it } from "vitest";

import { buildWritePreview } from "@/services/actionPreview";

/** 审批预览单测：保证作者看到的逐条差异与实际提交的 edits 一一对应。 */
describe("buildWritePreview", () => {
  it("apply_edits 生成逐条原文与替换", () => {
    const preview = buildWritePreview("apply_edits", {
      chapterId: "c1",
      edits: [
        { quote: "他走进房间", replacement: "他推门而入" },
        { quote: "天气很好", replacement: "天光澄澈" },
      ],
    });
    expect(preview?.target).toBe("章节 c1");
    expect(preview?.items).toHaveLength(2);
    expect(preview?.items[0]).toMatchObject({
      quote: "他走进房间",
      replacement: "他推门而入",
      truncated: false,
    });
  });

  it("未指定章节时目标显示为当前章节", () => {
    const preview = buildWritePreview("apply_edits", {
      edits: [{ quote: "a", replacement: "b" }],
    });
    expect(preview?.target).toBe("当前章节");
  });

  it("非 apply_edits 工具没有预览", () => {
    expect(buildWritePreview("propose_text", { content: "一段正文" })).toBeUndefined();
    expect(buildWritePreview("apply_edits", { edits: "not an array" })).toBeUndefined();
  });

  it("格式不对的条目被跳过并计数，有效条目仍展示", () => {
    const preview = buildWritePreview("apply_edits", {
      edits: [
        { quote: "  ", replacement: "空原文" },
        { quote: "有效", replacement: 42 },
        null,
        { quote: "保留", replacement: "新文字" },
      ],
    });
    expect(preview?.skipped).toBe(3);
    expect(preview?.items).toHaveLength(1);
    expect(preview?.items[0].quote).toBe("保留");
  });

  it("超长文字截断显示并标记，完整内容仍由工具写入", () => {
    const long = "很长".repeat(80);
    const preview = buildWritePreview("apply_edits", {
      edits: [{ quote: "原文", replacement: long }],
    });
    const item = preview?.items[0];
    expect(item?.truncated).toBe(true);
    expect(item?.replacement.length).toBeLessThan(long.length);
    expect(item?.replacement.endsWith("…")).toBe(true);
  });
});
