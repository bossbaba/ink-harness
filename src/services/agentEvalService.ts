import { tauriApi } from "@/api/tauri";
import type { AgentEvalRun, NewAgentEvalRun } from "@/types";

/**
 * 评测结果存取门面：跑分在前端（agentEval.ts），这里只负责落库与读取。
 * 页面与 composable 不直接调 IPC，保持 service 层收口。
 */
export const agentEvalService = {
  save: (input: NewAgentEvalRun): Promise<AgentEvalRun> => tauriApi.saveAgentEvalRun(input),
  /** 取评测历史；传 projectId 时只返回该作品的跑分，limit 为 0 用后端默认条数。 */
  list: (limit = 20, projectId?: string): Promise<AgentEvalRun[]> =>
    tauriApi.listAgentEvalRuns(limit, projectId),
};
