import { beforeEach, describe, expect, it, vi } from "vitest";

/** 评测存取层单测：锁定「历史按作品过滤」的转发契约，避免切作品后基线串台。 */
const { listRuns } = vi.hoisted(() => ({ listRuns: vi.fn() }));

vi.mock("@/api/tauri", () => ({
  tauriApi: {
    saveAgentEvalRun: vi.fn(),
    listAgentEvalRuns: listRuns,
  },
}));

import { agentEvalService } from "@/services/agentEvalService";

describe("agentEvalService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRuns.mockResolvedValue([]);
  });

  it("不传作品时拉全量历史，保持老调用方兼容", async () => {
    await agentEvalService.list();
    expect(listRuns).toHaveBeenCalledWith(20, undefined);
  });

  it("传作品时把 projectId 转给 IPC，只取该作品的跑分", async () => {
    await agentEvalService.list(10, "project-1");
    expect(listRuns).toHaveBeenCalledWith(10, "project-1");
  });

  it("limit 为 0 时原样透传，由后端套默认条数", async () => {
    await agentEvalService.list(0, "project-2");
    expect(listRuns).toHaveBeenCalledWith(0, "project-2");
  });
});
