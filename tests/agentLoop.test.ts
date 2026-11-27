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

import { type AgentLoopInput, runAgentLoop } from "@/services/agentLoop";
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

  it("重复调用同一工具时先提醒换工具，连续两次重复才终止", async () => {
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
    // 第 1 次正常执行、第 2 次提醒、第 3 次仍重复才终止。
    expect(runner).toHaveBeenCalledTimes(3);
    // 提醒那轮不重跑工具，省一次无意义的执行。
    expect(result.steps[1].observations).toHaveLength(0);
    const reminded = runner.mock.calls[2][1] as Array<{ content: string }>;
    expect(reminded.some((m) => m.content.includes("已经用相同参数调用过"))).toBe(true);
  });

  it("提醒后改用其它工具就能继续，不判空转", async () => {
    const listCall = {
      id: "c1",
      name: "list_elements",
      arguments: {},
      rawArguments: "{}",
      parseError: "",
    };
    const readCall = {
      id: "c2",
      name: "read_chapter",
      arguments: { withContent: true },
      rawArguments: '{"withContent":true}',
      parseError: "",
    };
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        raw: "",
        toolCalls: [listCall],
        failure: "",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "",
        toolCalls: [listCall],
        failure: "",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "",
        toolCalls: [readCall],
        failure: "",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({ raw: "改好了", toolCalls: [], failure: "" } satisfies ChatRunResult);

    const result = await runAgentLoop(base, runner);
    expect(result.reason).toBe("no-tools");
    expect(result.answer).toBe("改好了");
    expect(result.steps.some((step) => step.calls[0]?.name === "read_chapter")).toBe(true);
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

  it("模型整轮没返回内容时给出可显示的兜底文案，不返回空串", async () => {
    // 本地模型思考型端点常出现「什么都没返回」：界面若只拿到空串就只剩一个「【第 1 轮】」。
    const runner = vi.fn().mockResolvedValue({
      raw: "",
      toolCalls: [],
      failure: "",
    } satisfies ChatRunResult);

    const result = await runAgentLoop(base, runner);

    expect(result.reason).toBe("no-tools");
    expect(result.answer.trim()).not.toBe("");
    expect(result.answer).toContain("模型没有返回内容");
  });

  it("达到轮次上限时也给出说明，作者才知道循环停在哪里", async () => {
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
    expect(result.answer).toContain("轮次上限");
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

  it("每轮把上游用量记成 steps 的 tokens，没报用量时记 0", async () => {
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
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "回答",
        toolCalls: [],
        failure: "",
        // 上游没给用量的第二轮：tokens 应为 0，而不是 undefined。
      } satisfies ChatRunResult);
    const result = await runAgentLoop(base, runner);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].tokens).toBe(30);
    expect(result.steps[1].tokens).toBe(0);
    // 耗时是本地测量的非负毫秒数，恒有值。
    expect(result.steps[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.steps[1].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("首轮要求取数时下发 requireTool，模型直接作答则补问一次并拿到工具调用", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        raw: "作品讲的是末日后的故事。",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult)
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
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "读完了，讲的是……",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult);

    const result = await runAgentLoop({ ...base, requireToolFirst: true }, runner);

    // 第一次与补问那轮都要强制工具；拿到工具后放开，第三轮不再强制。
    expect(runner.mock.calls.map((call) => call[0].requireTool)).toEqual([true, true, false]);
    // 补问把模型刚才的回答与追问一起带回上下文，模型才知道要接着做什么。
    // 注意 messages 是同一个数组引用，后续轮次还会往里追加 tool 消息，所以按内容找而不是取末条。
    const retryMessages: Array<{ role: string; content: string }> = runner.mock.calls[1][1];
    expect(retryMessages.some((m) => m.content.includes("没有调用任何工具"))).toBe(true);
    expect(retryMessages.some((m) => m.role === "assistant" && m.content.includes("末日"))).toBe(
      true,
    );
    expect(result.reason).toBe("no-tools");
    expect(result.answer).toContain("读完了");
  });

  it("补问一次后仍不调用工具就接受回答，不会无限追问", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: "我不需要工具。",
      toolCalls: [],
      failure: "",
    } satisfies ChatRunResult);

    const result = await runAgentLoop({ ...base, requireToolFirst: true }, runner);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.reason).toBe("no-tools");
    expect(result.steps).toHaveLength(2);
  });

  it("把 requestId 带到每一轮请求，停止时后端才能按它中断当前流", async () => {
    const call = {
      id: "c1",
      name: "get_project",
      arguments: {},
      rawArguments: "{}",
      parseError: "",
    };
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ raw: "", toolCalls: [call], failure: "" } satisfies ChatRunResult)
      .mockResolvedValueOnce({ raw: "答完了", toolCalls: [], failure: "" } satisfies ChatRunResult);

    await runAgentLoop({ ...base, requestId: "copilot-7" }, runner);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls.every((args) => args[0].requestId === "copilot-7")).toBe(true);
  });
});

/** 自主规划模式：首次拆解、计划推进与重规划，全部用注入 runner 隔离真实模型。 */
describe("runAgentLoop 规划模式", () => {
  const planRaw = '{"steps":[{"title":"读正文","intent":"拿到第三章原文"}]}';

  it("循环前先拆解任务，并把计划注入每轮 system", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ raw: planRaw, toolCalls: [], failure: "" } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "看完了",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult);
    const onPlan = vi.fn();

    const result = await runAgentLoop({ ...base, planning: true, onPlan }, runner);

    expect(runner).toHaveBeenCalledTimes(2);
    // 第一次调用是规划器：它的 system 里有「任务规划器」字样。
    expect(runner.mock.calls[0][1][0].content as string).toContain("任务规划器");
    // 工作轮的 system 里带上了刚生成的计划。
    expect(runner.mock.calls[1][1][0].content as string).toContain("任务计划 v1");
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(result.plan?.steps[0].title).toBe("读正文");
    expect(result.steps[0]).toMatchObject({ iteration: 0, phase: "plan" });
  });

  it("模型用 update_plan 推进步骤时更新计划并回填观察，不误判为空转", async () => {
    const updateCall = {
      id: "u1",
      name: "update_plan",
      arguments: { stepId: "s1", status: "done", result: "拿到 3000 字" },
      rawArguments: '{"stepId":"s1","status":"done","result":"拿到 3000 字"}',
      parseError: "",
    };
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ raw: planRaw, toolCalls: [], failure: "" } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "",
        toolCalls: [updateCall],
        failure: "",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "已完成检查",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult);
    const onPlan = vi.fn();

    const result = await runAgentLoop({ ...base, planning: true, onPlan }, runner);

    expect(onPlan).toHaveBeenCalledTimes(2);
    expect(result.plan?.steps[0]).toMatchObject({ status: "done", result: "拿到 3000 字" });
    // 连续两轮只发计划元工具也不能触发空转保护：元工具代表有进展。
    expect(result.reason).toBe("no-tools");
    const secondMessages = runner.mock.calls[2][1] as Array<{ content: string; role: string }>;
    expect(secondMessages.some((m) => m.content.includes("计划已更新"))).toBe(true);
  });

  it("模型请求 replan 时生成 v2 计划并记入轨迹", async () => {
    const replanCall = {
      id: "r1",
      name: "replan",
      arguments: { reason: "设定与正文冲突" },
      rawArguments: '{"reason":"设定与正文冲突"}',
      parseError: "",
    };
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ raw: planRaw, toolCalls: [], failure: "" } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "",
        toolCalls: [replanCall],
        failure: "",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: '{"steps":[{"title":"重查设定"}]}',
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "重新答完",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult);

    const result = await runAgentLoop({ ...base, planning: true }, runner);

    expect(result.plan?.version).toBe(2);
    expect(result.plan?.reason).toBe("设定与正文冲突");
    expect(result.plan?.steps[0].title).toBe("重查设定");
    // 首次规划 + 重规划各记一条 phase=plan 的轨迹。
    expect(result.steps.filter((step) => step.phase === "plan")).toHaveLength(2);
    // 重规划的 question 带着原因，模型才知道为什么改计划。
    const replanQuestion = runner.mock.calls[2][1][1].content as string;
    expect(replanQuestion).toContain("设定与正文冲突");
  });

  it("规划请求失败时降级为普通循环，不挡住回答", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        raw: "规划模型挂了",
        toolCalls: [],
        failure: "网络异常",
      } satisfies ChatRunResult)
      .mockResolvedValueOnce({
        raw: "直接回答",
        toolCalls: [],
        failure: "",
      } satisfies ChatRunResult);

    const result = await runAgentLoop({ ...base, planning: true }, runner);

    expect(result.reason).toBe("no-tools");
    expect(result.answer).toBe("直接回答");
    expect(result.plan).toBeUndefined();
    expect(result.steps[0].text).toContain("规划未采用");
  });

  it("关闭规划时不额外发规划请求，行为与原来一致", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: "普通回答",
      toolCalls: [],
      failure: "",
    } satisfies ChatRunResult);

    const result = await runAgentLoop(base, runner);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.plan).toBeUndefined();
    expect(result.steps.some((step) => step.phase === "plan")).toBe(false);
  });
});
