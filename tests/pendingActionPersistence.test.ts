import { beforeEach, describe, expect, it, vi } from "vitest";

// 用内存版 localStorage 验证待审批快照的写入与作废；执行器按工具名重建 tool 引用，
// 所以这里 mock 掉工具可能碰到的 service，保证测试只关心队列持久化本身。
const store = new Map<string, string>();
const fakeStorage = {
  get length() {
    return store.size;
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", fakeStorage);

vi.mock("@/services/storyElementService", () => ({
  storyElementService: { get: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/services/projectService", () => ({
  projectService: { get: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/services/outlineService", () => ({
  outlineService: { snapshot: vi.fn().mockResolvedValue({ chapters: [] }) },
}));
vi.mock("@/services/ragService", () => ({
  ragService: { search: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/services/writingService", () => ({
  writingService: { getContent: vi.fn(), saveContent: vi.fn() },
}));

import {
  discardPending,
  executeCalls,
  listPending,
  resetPendingForTest,
} from "@/services/actionExecutor";
import type { CollectedToolCall } from "@/types";

const ctx = { projectId: "p1", sessionId: "s1" };

function writeCall(name: string, args: Record<string, unknown>): CollectedToolCall {
  return {
    id: "call-1",
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    parseError: "",
  };
}

describe("待审批队列持久化", () => {
  beforeEach(() => {
    resetPendingForTest();
    store.clear();
  });

  it("write 工具入队后按作用域写入本地快照", async () => {
    await executeCalls([writeCall("propose_text", { content: "一段草稿" })], ctx);
    expect(store.size).toBe(1);
    const key = Array.from(store.keys())[0];
    expect(key).toContain("p1::s1");
    const snapshot = JSON.parse(store.get(key) ?? "[]") as Array<{ toolName: string }>;
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].toolName).toBe("propose_text");
  });

  it("作废后内存队列与本地快照一起清掉", async () => {
    await executeCalls([writeCall("propose_text", { content: "一段草稿" })], ctx);
    expect(listPending(ctx)).toHaveLength(1);
    discardPending(ctx);
    expect(store.size).toBe(0);
    expect(listPending(ctx)).toHaveLength(0);
  });

  it("不同会话的待审批快照互不覆盖", async () => {
    await executeCalls([writeCall("propose_text", { content: "甲" })], ctx);
    await executeCalls([writeCall("propose_text", { content: "乙" })], {
      ...ctx,
      sessionId: "s2",
    });
    expect(store.size).toBe(2);
  });

  it("重启后按工具名重建待审批动作", async () => {
    await executeCalls([writeCall("propose_text", { content: "一段草稿" })], ctx);
    const key = Array.from(store.keys())[0];
    const raw = store.get(key) ?? "";

    // 模拟进程重启：模块重新加载后内存队列为空，只剩 localStorage 里的快照。
    vi.resetModules();
    store.set(key, raw);
    const fresh = await import("@/services/actionExecutor");
    const restored = fresh.listPending(ctx);
    expect(restored).toHaveLength(1);
    expect(restored[0].toolName).toBe("propose_text");
    expect(restored[0].status).toBe("pending");
    expect(restored[0].args).toEqual({ content: "一段草稿" });
  });
});
