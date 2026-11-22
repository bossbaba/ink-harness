import { runAgentLoop } from "@/services/agentLoop";
import { buildCopilotSystem } from "@/services/copilotService";
import type { AgentEvalCaseResult, Project } from "@/types";

/**
 * Agent 回归评测：用一组固定任务跑真实 Agent Loop，记录是否用对工具、有没有报错、
 * 轮次与 token 消耗。目的是「换模型 / 改提示词 / 加工具之后有没有变差」，
 * 不追求语义级打分（那需要另一个模型当裁判，成本和稳定性都不可控）。
 *
 * 判定口径刻意保守：期望工具命中 + 无错误观察 + 循环正常结束 + 有最终回答，
 * 全满足才算通过。这样失败用例一定值得看一眼，而不是一堆「语义不达标」的噪音。
 */

/** 跑评测需要的作品上下文；章节缺失时只跑不依赖章节的用例。 */
export interface AgentEvalContext {
  project: Project;
  chapterId?: string;
  chapterTitle?: string;
}

/** 一个评测用例：问什么、期望用到哪些工具、什么情况下跳过。 */
export interface AgentEvalCase {
  id: string;
  title: string;
  /** 命中其中任意一个工具即算工具使用正确。 */
  expectTools: string[];
  question: (ctx: AgentEvalContext) => string;
  /** 返回非空字符串表示跳过，理由会展示在结果里。 */
  skip?: (ctx: AgentEvalContext) => string;
}

/**
 * 内置用例：覆盖读作品、列设定、读章节、检索、写候选五条主链路。
 * 不包含 propose_review——它内部会再调一次模型，跑一次评测等于双倍耗时与费用，
 * 需要时由作者在写作台手动验证。
 */
export const AGENT_EVAL_CASES: AgentEvalCase[] = [
  {
    id: "project-info",
    title: "读取作品信息",
    expectTools: ["get_project"],
    question: () => "先读一下当前作品的基本信息，再用一句话告诉我它讲什么。",
  },
  {
    id: "list-elements",
    title: "列出设定条目",
    expectTools: ["list_elements"],
    question: () => "列出这部作品的设定条目，按类型分组说清楚各有哪些。",
  },
  {
    id: "read-chapter",
    title: "读取当前章节",
    expectTools: ["read_chapter"],
    skip: (ctx) => (ctx.chapterId ? "" : "当前作品还没有章节"),
    question: () => "读一下当前这一章，用三句话概括它的内容。",
  },
  {
    id: "search-notes",
    title: "检索相关资料",
    expectTools: ["search_notes"],
    question: () => "在设定与正文里检索「主角」，说说明显相关的片段有哪些。",
  },
  {
    id: "propose-text",
    title: "产出修改候选",
    expectTools: ["propose_text", "apply_edits"],
    question: () => "针对当前章节写一小段修改候选，提交给我审批，不要直接改动正文。",
  },
];

/** 单次跑评测的输入。 */
export interface RunAgentEvalInput {
  ctx: AgentEvalContext;
  /** 角色允许的工具名；为空表示全部。 */
  toolNames?: string[];
  /** 角色附加提示。 */
  extraPrompt?: string;
  /** 模型是否支持标准工具调用；false 走 JSON 降级轨。 */
  supportsTools: boolean;
  /** 用例集，默认内置 5 条；测试可注入。 */
  cases?: AgentEvalCase[];
  /** 每轮次上限，评测用 4 轮：再多说明模型在兜圈子，本身就是失败信号。 */
  maxIterations?: number;
  /** 进度回调：已完成数 / 总数 / 当前用例标题。 */
  onProgress?: (done: number, total: number, title: string) => void;
  /** 作者点停止时返回 true；剩余用例标记为跳过。 */
  shouldStop?: () => boolean;
}

/** 跑评测的汇总结果，字段与落库结构对齐。 */
export interface RunAgentEvalResult {
  cases: AgentEvalCaseResult[];
  passed: number;
  rounds: number;
  tokens: number;
  durationMs: number;
  /** 实际使用的模型（providerId:modelId）；没选到模型时为空串。 */
  model: string;
}

/**
 * 跑一遍评测。逐用例串行执行：并行会让本地小模型抢显存，
 * 延迟数据失真，而且失败时很难定位是并发问题还是用例问题。
 */
export async function runAgentEval(input: RunAgentEvalInput): Promise<RunAgentEvalResult> {
  const cases = input.cases ?? AGENT_EVAL_CASES;
  const startedAt = Date.now();
  const results: AgentEvalCaseResult[] = [];
  let rounds = 0;
  let tokens = 0;
  let model = "";

  for (const [index, testCase] of cases.entries()) {
    input.onProgress?.(index, cases.length, testCase.title);

    const skipReason = testCase.skip?.(input.ctx) ?? "";
    if (skipReason) {
      results.push({
        caseId: testCase.id,
        title: testCase.title,
        ok: false,
        reason: `跳过：${skipReason}`,
        rounds: 0,
        calls: [],
        tokens: 0,
      });
      continue;
    }
    if (input.shouldStop?.()) {
      results.push({
        caseId: testCase.id,
        title: testCase.title,
        ok: false,
        reason: "跳过：已取消",
        rounds: 0,
        calls: [],
        tokens: 0,
      });
      continue;
    }

    const result = await runAgentLoop({
      task: "copilot",
      privacy: input.ctx.project.privacy,
      projectId: input.ctx.project.id,
      ctx: { projectId: input.ctx.project.id, chapterId: input.ctx.chapterId },
      // 评测只考察工具使用与循环收敛，不给章节正文与 RAG 上下文：
      // 这两块体积大、会影响思考质量，混进来会让「变差」无法归因到工具层。
      system: buildCopilotSystem({
        project: input.ctx.project,
        chapterTitle: input.ctx.chapterTitle ?? "",
        chapterSummary: "",
        chapterText: "",
        context: "",
        contextLimit: 0,
      }),
      history: [],
      question: testCase.question(input.ctx),
      supportsTools: input.supportsTools,
      toolNames: input.toolNames,
      extraPrompt: input.extraPrompt ?? "",
      // 评测考察的就是「会不会主动取数」，首轮必须给足压力，否则分数只反映模型的编造能力。
      requireToolFirst: input.supportsTools,
      maxIterations: input.maxIterations ?? 4,
      shouldStop: input.shouldStop,
    });

    const calls = result.steps.flatMap((step) => step.calls.map((call) => call.name));
    const caseTokens = result.steps.reduce((sum, step) => sum + step.tokens, 0);
    const hasError = result.steps.some((step) =>
      step.observations.some((observation) => observation.isError),
    );
    const usedExpectedTool = testCase.expectTools.some((name) => calls.includes(name));
    const answered = result.answer.trim().length > 0;

    let reason = "";
    if (result.failure) reason = result.failure;
    else if (result.reason === "stopped") reason = "被取消";
    else if (result.reason === "idle-loop") reason = "重复调用同一工具，空转终止";
    else if (result.reason === "max-iterations") reason = "达到轮次上限仍未给出结论";
    else if (hasError) reason = "工具执行报错";
    else if (!usedExpectedTool)
      reason = `没有调用期望工具（期望 ${testCase.expectTools.join(" / ")}）`;
    else if (!answered) reason = "没有最终回答";

    results.push({
      caseId: testCase.id,
      title: testCase.title,
      ok: !reason,
      reason,
      rounds: result.steps.length,
      calls: Array.from(new Set(calls)),
      tokens: caseTokens,
    });

    rounds += result.steps.length;
    tokens += caseTokens;
    model = result.steps[result.steps.length - 1]?.model || model;
  }

  input.onProgress?.(cases.length, cases.length, "");
  return {
    cases: results,
    passed: results.filter((item) => item.ok).length,
    rounds,
    tokens,
    durationMs: Date.now() - startedAt,
    model,
  };
}
