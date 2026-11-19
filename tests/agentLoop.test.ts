import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/actionExecutor", () => ({
  executeCalls: vi
    .fn()
    .mockResolvedValue([
      { toolCallId: "c1", toolName: "get_project", content: "读到作品", isError: false },
    ]),
}));
vi.mock("@/services/agentTools", () => ({
  toToolDefinitions: vi.fn().mockReturnValue([]),
}));

import { runAgentLoop, type AgentLoopInput } from "@/services/agentLoop";
import type { ChatRunResult } from "@/services/aiChat";

const base: AgentLoopInput = {
  task: "copilot",
  privacy: "any",
  projectId: "p1",
  ctx: { projectId: "p1" },
  system: "你是助手",
  history: [],
  question: "检查第三章",
  supportsTools: true,
};

/** Agent Loop 单测锁死终止条件、空转检测与回填消息，不依赖真实模型与工具。 */
describe("runAgentLoop", () => {
  it("模型不再请求工具时正常结束并返回回答", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: "这是最终回答",
      toolCalls: [],
      failure: "",
    } satisfies ChatRunResult);
    const result = await runAgentLoop(base, runner);
    expect(result.reason).toBe("no-tools");
    expect(result.answer).toBe("这是最终回答");
    expect(result.steps).toHaveLength(1);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("有工具调用时继续下一轮，把观察回填成 tool 消息", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        raw: "",
        toolCalls: [
          {
            id: "c1",
            name: "get_project",
            arguments: {},
            rawArguments: "{}",
            parseError: "",
          },
        ],
        failure: "",
      })
      .mockResolvedValueOnce({
        raw: "看完作品了",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult);
    const result = await runAgentLoop(base, runner);
    expect(result.reason).toBe("no-tools");
    expect(result.steps).toHaveLength(2);
    const secondMessages = runner.mock.calls[1][1];
    expect(secondMessages.some((m: { role: string }) => m.role === "tool")).toBe(true);
    expect(secondMessages.some((m: { toolCalls?: unknown }) => m.toolCalls)).toBe(true);
  });

  it("连续两轮相同工具调用触发空转保护", async () => {
    const call = {
      id: "c1",
      name: "get_project",
      arguments: {},
      rawArguments: "{}",
      parseError: "",
    };
    const runner = vi
      .fn()
      .mockResolvedValue({ raw: "", toolCalls: [call], failure: "" } satisfies ChatRunResult);
    const result = await runAgentLoop(base, runner);
    expect(result.reason).toBe("idle-loop");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("达到轮次上限时停止", async () => {
    // 每轮参数不同，避免先触发空转保护；专注验证轮次上限这条终止路径。
    let round = 0;
    const runner = vi.fn().mockImplementation(async () => {
      round += 1;
      return {
        raw: "",
        toolCalls: [
          {
            id: `c${round}`,
            name: "inspect_element",
            arguments: { id: `e${round}` },
            rawArguments: JSON.stringify({ id: `e${round}` }),
            parseError: "",
          },
        ],
        failure: "",
      } satisfies ChatRunResult;
    });
    const result = await runAgentLoop({ ...base, maxIterations: 2 }, runner);
    expect(result.reason).toBe("max-iterations");
    expect(result.steps).toHaveLength(2);
  });

  it("作者在循环开始前点停止时立即退出且不发请求", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: "",
      toolCalls: [],
      failure: "",
    } satisfies ChatRunResult);
    const result = await runAgentLoop({ ...base, shouldStop: () => true }, runner);
    expect(result.reason).toBe("stopped");
    expect(runner).not.toHaveBeenCalled();
  });

  it("失败原因原样返回", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: "",
      toolCalls: [],
      failure: "没有可用模型",
    } satisfies ChatRunResult);
    const result = await runAgentLoop(base, runner);
    expect(result.reason).toBe("error");
    expect(result.failure).toBe("没有可用模型");
  });
});
