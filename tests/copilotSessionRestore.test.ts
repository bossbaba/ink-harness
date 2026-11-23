import { describe, expect, it } from "vitest";

import { toMessages } from "@/composables/useCopilotMessaging";
import type { AgentMessageRecord } from "@/types";

/** 会话恢复单测：引用与工具名摘要要能重建，坏数据不能让整屏打不开。 */
function record(overrides: Partial<AgentMessageRecord> = {}): AgentMessageRecord {
  return {
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: "检查第三章",
    toolCalls: "",
    stopReason: "",
    references: "",
    createdAt: "2026-11-23T00:00:00Z",
    ...overrides,
  };
}

describe("toMessages 会话恢复", () => {
  it("恢复用户提问携带的 @引用 标签", () => {
    const refs = [
      { kind: "element", id: "e1", label: "女主设定" },
      { kind: "chapter", id: "c3", label: "第三章" },
    ];
    const messages = toMessages([record({ references: JSON.stringify(refs) })]);
    expect(messages[0].references).toEqual(refs);
  });

  it("从落库的工具调用里解析出工具名摘要", () => {
    const toolCalls = JSON.stringify([
      { name: "get_project", arguments: {} },
      { name: "read_chapter", arguments: { chapterId: "c3" } },
      { name: "read_chapter", arguments: { chapterId: "c4" } },
    ]);
    const messages = toMessages([record({ role: "assistant", toolCalls })]);
    expect(messages[0].toolNames).toEqual(["get_project", "read_chapter", "read_chapter"]);
  });

  it("跳过格式异常的工具调用，不把脏数据带进界面", () => {
    const toolCalls = JSON.stringify([{ name: "read_chapter" }, {}, { name: 42 }]);
    const messages = toMessages([record({ role: "assistant", toolCalls })]);
    expect(messages[0].toolNames).toEqual(["read_chapter"]);
  });

  it("老记录空字段与坏 JSON 都按没有引用处理", () => {
    const old = toMessages([record({ references: "", toolCalls: "" })]);
    expect(old[0].references).toEqual([]);
    expect(old[0].toolNames).toEqual([]);
    const broken = toMessages([record({ references: "not json", toolCalls: "{oops" })]);
    expect(broken[0].references).toEqual([]);
    expect(broken[0].toolNames).toEqual([]);
  });

  it("assistant 与 user 角色正确区分，其他字段原样保留", () => {
    const messages = toMessages([
      record({ role: "user", content: "问题" }),
      record({ id: "m2", role: "assistant", content: "回答", stopReason: "no-tools" }),
      record({ id: "m3", role: "tool", content: "工具结果" }),
    ]);
    expect(messages.map((item) => item.role)).toEqual(["user", "assistant", "assistant"]);
    expect(messages[1].content).toBe("回答");
  });
});
