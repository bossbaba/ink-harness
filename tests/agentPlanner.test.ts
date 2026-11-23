import { describe, expect, it, vi } from "vitest";

import {
  applyPlanUpdates,
  makePlan,
  parsePlan,
  planToText,
  REPLAN_TOOL,
  UPDATE_PLAN_TOOL,
} from "@/services/agentPlanner";
import type { AgentPlan, CollectedToolCall } from "@/types";

/** Planner 单测锁定：解析容错、步骤上限、不可变更新与重规划参数，不依赖真实模型。 */
describe("parsePlan", () => {
  it("解析标准 JSON 步骤并给首步标记为进行中", () => {
    const plan = parsePlan(
      '{"steps":[{"title":"读第三章正文","intent":"拿到原文"},{"title":"对照设定检查"}]}',
      "检查第三章",
      1,
    );
    expect(plan).not.toBeNull();
    expect(plan?.goal).toBe("检查第三章");
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0]).toMatchObject({
      id: "s1",
      title: "读第三章正文",
      intent: "拿到原文",
      status: "active",
    });
    expect(plan?.steps[1].status).toBe("pending");
  });

  it("容忍代码块包裹与前后散字", () => {
    const plan = parsePlan(
      '好的，计划如下：\n```json\n{"steps":[{"title":"检索设定"}]}\n```\n以上。',
      "找设定",
      1,
    );
    expect(plan?.steps[0].title).toBe("检索设定");
  });

  it("步骤数超过上限时截断，且 id 连续", () => {
    const steps = Array.from({ length: 9 }, (_, index) => ({ title: `第 ${index + 1} 步` }));
    const plan = parsePlan(JSON.stringify({ steps }), "大任务", 1);
    expect(plan?.steps).toHaveLength(5);
    expect(plan?.steps.map((step) => step.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  it("跳过无标题项，全部非法时返回 null", () => {
    expect(parsePlan('{"steps":[{}, {"intent":"没有标题"}]}', "目标", 1)).toBeNull();
    expect(parsePlan("不是 JSON", "目标", 1)).toBeNull();
    expect(parsePlan('{"other":[]}', "目标", 1)).toBeNull();
  });
});

describe("makePlan", () => {
  const base = {
    goal: "检查第三章",
    system: "作品上下文",
    toolNames: ["read_chapter", "list_elements"],
    task: "copilot" as const,
    privacy: "any" as const,
    projectId: "p1",
  };

  it("调用注入的 runner 并把输出解析成计划", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: '{"steps":[{"title":"读正文"}]}',
      toolCalls: [],
      failure: "",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const result = await makePlan(base, runner);
    expect(result.plan?.steps[0].title).toBe("读正文");
    expect(result.tokens).toBe(15);
    const system = runner.mock.calls[0][1][0].content as string;
    expect(system).toContain("read_chapter");
    expect(system).toContain("最多 5 步");
  });

  it("请求失败时 plan 为 null 但保留错误与原始输出", async () => {
    const runner = vi.fn().mockResolvedValue({
      raw: "上游报错了",
      toolCalls: [],
      failure: "网络异常",
    });
    const result = await makePlan(base, runner);
    expect(result.plan).toBeNull();
    expect(result.failure).toBe("网络异常");
    expect(result.raw).toBe("上游报错了");
  });

  it("重规划时版本递增，问题携带原因与已完成事实", async () => {
    const previous: AgentPlan = {
      goal: base.goal,
      version: 1,
      reason: "",
      steps: [
        { id: "s1", title: "读正文", intent: "", status: "done", result: "读到 3000 字" },
        { id: "s2", title: "对照设定", intent: "", status: "pending", result: "" },
      ],
    };
    const runner = vi.fn().mockResolvedValue({
      raw: '{"steps":[{"title":"重查设定"}]}',
      toolCalls: [],
      failure: "",
    });
    const result = await makePlan({ ...base, previous, reason: "设定与正文冲突" }, runner);
    expect(result.plan?.version).toBe(2);
    expect(result.plan?.reason).toBe("设定与正文冲突");
    const question = runner.mock.calls[0][1][1].content as string;
    expect(question).toContain("设定与正文冲突");
    expect(question).toContain("读到 3000 字");
    expect(question).not.toContain("对照设定");
  });
});

/** 计划元工具的定义与更新逻辑。 */
describe("plan tools", () => {
  it("元工具有明确的 schema，供标准轨下发与降级轨提示", () => {
    expect(UPDATE_PLAN_TOOL.function.name).toBe("update_plan");
    expect(REPLAN_TOOL.function.name).toBe("replan");
    expect(UPDATE_PLAN_TOOL.function.parameters).toMatchObject({ required: ["stepId", "status"] });
    expect(REPLAN_TOOL.function.parameters).toMatchObject({ required: ["reason"] });
  });

  it("更新步骤返回新计划对象并生成观察，不改动原计划", () => {
    const plan: AgentPlan = {
      goal: "目标",
      version: 1,
      reason: "",
      steps: [
        { id: "s1", title: "读正文", intent: "", status: "active", result: "" },
        { id: "s2", title: "给建议", intent: "", status: "pending", result: "" },
      ],
    };
    const call: CollectedToolCall = {
      id: "u1",
      name: "update_plan",
      arguments: { stepId: "s1", status: "done", result: "拿到正文" },
      rawArguments: "{}",
      parseError: "",
    };
    const result = applyPlanUpdates(plan, [call]);
    expect(result.plan).not.toBe(plan);
    expect(result.plan.steps[0]).toMatchObject({ status: "done", result: "拿到正文" });
    expect(plan.steps[0].status).toBe("active");
    expect(result.observations[0]).toMatchObject({
      toolCallId: "u1",
      content: "计划已更新：读正文 → 已完成",
      isError: false,
    });
  });

  it("未知步骤只返回错误观察，不影响其它调用", () => {
    const plan: AgentPlan = {
      goal: "目标",
      version: 1,
      reason: "",
      steps: [{ id: "s1", title: "读正文", intent: "", status: "active", result: "" }],
    };
    const bad: CollectedToolCall = {
      id: "bad",
      name: "update_plan",
      arguments: { stepId: "nope", status: "done" },
      rawArguments: "{}",
      parseError: "",
    };
    const good: CollectedToolCall = {
      id: "ok",
      name: "update_plan",
      arguments: { stepId: "s1", status: "done" },
      rawArguments: "{}",
      parseError: "",
    };
    const result = applyPlanUpdates(plan, [bad, good]);
    expect(result.observations[0].isError).toBe(true);
    expect(result.observations[1].isError).toBe(false);
    expect(result.plan.steps[0].status).toBe("done");
  });

  it("planToText 带版本号、目标与步骤状态", () => {
    const plan: AgentPlan = {
      goal: "检查第三章",
      version: 2,
      reason: "设定冲突",
      steps: [{ id: "s1", title: "读正文", intent: "", status: "done", result: "拿到正文" }],
    };
    const text = planToText(plan);
    expect(text).toContain("任务计划 v2");
    expect(text).toContain("检查第三章");
    expect(text).toContain("已完成 s1. 读正文（拿到正文）");
    expect(text).toContain("update_plan");
  });
});
