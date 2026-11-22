import { describe, expect, it, vi } from "vitest";

// 工具会调真实 service（底层是 Tauri IPC），单测里 mock 掉，只验证执行器的分流逻辑。
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

import {
  approveAction,
  executeCalls,
  listPending,
  rejectAction,
  resetPendingForTest,
} from "@/services/actionExecutor";
import type { CollectedToolCall } from "@/types";

const ctx = { projectId: "p1", chapterId: "c1" };

function call(overrides: Partial<CollectedToolCall>): CollectedToolCall {
  return {
    id: "call-1",
    name: "get_project",
    arguments: {},
    rawArguments: "{}",
    parseError: "",
    ...overrides,
  };
}

/** 执行器的单测锁死两件事：read 自动执行、write 必须审批；以及坏输入不炸。 */
describe("actionExecutor", () => {
  it("read 工具直接执行并回填结果", async () => {
    const results = await executeCalls(
      [call({ name: "inspect_element", arguments: { id: "x" } })],
      ctx,
    );
    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(false);
    expect(results[0].content).toContain("不存在");
  });

  it("write 工具挂起等待审批，不进入执行", async () => {
    resetPendingForTest();
    const results = await executeCalls(
      [call({ name: "propose_text", arguments: { content: "一段候选正文" } })],
      ctx,
    );
    expect(results[0].content).toContain("作者审批");
    const pending = listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");
  });

  it("审批通过后执行并返回结果，驳回则标记 rejected", async () => {
    resetPendingForTest();
    await executeCalls(
      [call({ name: "propose_text", arguments: { content: "候选", label: "改写开头" } })],
      ctx,
    );
    const id = listPending()[0].id;
    const approved = await approveAction(id, ctx);
    expect(approved?.status).toBe("applied");
    expect(approved?.label).toContain("候选");

    await executeCalls(
      [call({ id: "call-2", name: "propose_text", arguments: { content: "候选2" } })],
      ctx,
    );
    const id2 = listPending().find((item) => item.status === "pending")?.id ?? "";
    expect(rejectAction(id2)?.status).toBe("rejected");
  });

  it("未注册工具与参数错误都转成 isError 观察而不抛", async () => {
    const unknown = await executeCalls([call({ name: "not_exist" })], ctx);
    expect(unknown[0].isError).toBe(true);
    expect(unknown[0].content).toContain("未注册");

    const bad = await executeCalls([call({ name: "search_notes", arguments: { limit: 3 } })], ctx);
    expect(bad[0].isError).toBe(true);
    expect(bad[0].content).toContain("缺少必填参数");
  });

  it("可选参数传 null 视为未提供，不判成参数错误", async () => {
    // 模型常把「不传」写成 null；这里以前会直接报「参数 chapterId 应为字符串」，
    // 结果是明明能读的章节被记成工具执行失败。
    const results = await executeCalls(
      [call({ name: "read_chapter", arguments: { chapterId: null, withContent: true } })],
      ctx,
    );
    expect(results[0].isError).toBe(false);
  });
});
