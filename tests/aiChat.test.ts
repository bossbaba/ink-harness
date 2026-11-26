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

  it("同一 index 被复用于下一次调用时拆成两条，不把参数拼坏", () => {
    // Ollama 偶发把两次调用都标成 index=0，旧实现会拼成 `{"query":".."}{}`。
    const chunks: ToolCallChunk[] = [
      { index: 0, id: "a", name: "search_notes", arguments: '{"query":"江游 芯片"}' },
      { index: 0, id: "b", name: "get_project", arguments: "{}" },
    ];
    const calls = collectToolCalls(chunks);
    expect(calls.map((call) => call.name)).toEqual(["search_notes", "get_project"]);
    expect(calls.map((call) => call.parseError)).toEqual(["", ""]);
    expect(calls[0].arguments).toEqual({ query: "江游 芯片" });
    expect(calls[1].arguments).toEqual({});
  });

  it("arguments 里连写多个对象时取第一段，不让整次调用被拒", () => {
    const calls = collectToolCalls([
      { index: 0, id: "x", name: "get_project", arguments: '{"query":"江游 芯片"}{}' },
    ]);
    expect(calls[0].parseError).toBe("");
    expect(calls[0].arguments).toEqual({ query: "江游 芯片" });
    expect(calls[0].rawArguments).toBe('{"query":"江游 芯片"}{}');
  });

  it("补发的完整 arguments 帧不会重复拼到原参数后面", () => {
    const chunks: ToolCallChunk[] = [
      { index: 0, id: "x", name: "read_chapter", arguments: '{"chapterId":"c1"}' },
      { index: 0, id: "", name: "", arguments: '{"chapterId":"c1"}' },
    ];
    const calls = collectToolCalls(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({ chapterId: "c1" });
    expect(calls[0].parseError).toBe("");
  });
});
