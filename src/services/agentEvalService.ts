import { tauriApi } from "@/api/tauri";
import type { AgentEvalRun, NewAgentEvalRun } from "@/types";

/**
 * 评测结果存取门面：跑分在前端（agentEval.ts），这里只负责落库与读取。
 * 页面与 composable 不直接调 IPC，保持 service 层收口。
 */
export const agentEvalService = {
  save: (input: NewAgentEvalRun): Promise<AgentEvalRun> => tauriApi.saveAgentEvalRun(input),
  list: (limit = 20): Promise<AgentEvalRun[]> => tauriApi.listAgentEvalRuns(limit),
};
