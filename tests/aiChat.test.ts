import { describe, expect, it } from "vitest";
import { collectToolCalls } from "@/services/aiChat";
import type { ToolCallChunk } from "@/types";

/**
 * 工具调用分片拼装单测：Agent Loop 依赖这里把流式到达的多帧还原成完整调用。
 * 重点锁死碎片拼接顺序、多工具按 index 分组、以及坏参数不抛异常的行为。
 */
describe("collectToolCalls", () => {
  it("把跨帧的 arguments 按到达顺序拼成一个完整调用", () => {
    const chunks: ToolCallChunk[] = [
      { index: 0, id: "call_1", name: "read_chapter", arguments: '{"id":' },
      { index: 0, id: "", name: "", arguments: '"c1"}' },
    ];
    const calls = collectToolCalls(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: "call_1",
      name: "read_chapter",
      arguments: { id: "c1" },
      parseError: "",
    });
  });

  it("多个工具按 index 分组且保持顺序", () => {
    const chunks: ToolCallChunk[] = [
      { index: 1, id: "b", name: "list_elements", arguments: "{}" },
      { index: 0, id: "a", name: "get_project", arguments: "{}" },
    ];
    const calls = collectToolCalls(chunks);
    expect(calls.map((c) => c.name)).toEqual(["get_project", "list_elements"]);
  });

  it("参数不是合法 JSON 时记录原因但不抛异常", () => {
    const chunks: ToolCallChunk[] = [{ index: 0, id: "x", name: "write", arguments: "{不是 json" }];
    const calls = collectToolCalls(chunks);
    expect(calls[0].parseError).toContain("工具参数解析失败");
    expect(calls[0].arguments).toEqual({});
    expect(calls[0].rawArguments).toBe("{不是 json");
  });

  it("参数为空串时按空对象处理，不算解析失败", () => {
    const calls = collectToolCalls([{ index: 0, id: "x", name: "no_args", arguments: "" }]);
    expect(calls[0].arguments).toEqual({});
    expect(calls[0].parseError).toBe("");
  });
});
