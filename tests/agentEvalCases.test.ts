import { describe, expect, it } from "vitest";

import {
  AGENT_EVAL_CASES,
  AGENT_EVAL_REVIEW_CASE,
  type AgentEvalContext,
} from "@/services/agentEval";

/** 评测用例集单测：锁定默认集不含双倍成本的审稿用例，且审稿用例无章节时自动跳过。 */
describe("评测用例集", () => {
  it("默认集覆盖五条主链路，不含审稿用例", () => {
    expect(AGENT_EVAL_CASES.map((item) => item.id)).toEqual([
      "project-info",
      "list-elements",
      "read-chapter",
      "search-notes",
      "propose-text",
    ]);
    expect(AGENT_EVAL_CASES.some((item) => item.id === "propose-review")).toBe(false);
  });

  it("审稿用例单独导出，有章节时才跑", () => {
    const withChapter: AgentEvalContext = {
      project: { id: "p1" } as AgentEvalContext["project"],
      chapterId: "c1",
      chapterTitle: "第三章",
    };
    const withoutChapter: AgentEvalContext = {
      project: { id: "p1" } as AgentEvalContext["project"],
    };
    expect(AGENT_EVAL_REVIEW_CASE.expectTools).toContain("propose_review");
    expect(AGENT_EVAL_REVIEW_CASE.skip?.(withChapter)).toBe("");
    expect(AGENT_EVAL_REVIEW_CASE.skip?.(withoutChapter)).toContain("章节");
  });
});
