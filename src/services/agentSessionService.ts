import { tauriApi } from "@/api/tauri";
import type {
  AgentMessageRecord,
  AgentOutcomeStats,
  AgentSession,
  AgentStepRecord,
  NewAgentMessage,
  NewAgentSession,
  NewAgentStep,
} from "@/types";

/**
 * Agent 会话门面：页面/composable 不直接调 IPC。
 * 会话记忆与轨迹都按作品隔离，读接口只读不改状态。
 */
export const agentSessionService = {
  create: (input: NewAgentSession): Promise<AgentSession> => tauriApi.createAgentSession(input),
  list: (projectId: string): Promise<AgentSession[]> => tauriApi.listAgentSessions(projectId),
  appendMessage: (input: NewAgentMessage): Promise<void> => tauriApi.appendAgentMessage(input),
  listMessages: (sessionId: string): Promise<AgentMessageRecord[]> =>
    tauriApi.listAgentMessages(sessionId),
  appendStep: (input: NewAgentStep): Promise<void> => tauriApi.appendAgentStep(input),
  listSteps: (projectId: string): Promise<AgentStepRecord[]> => tauriApi.listAgentSteps(projectId),
  /** 全局的成功率聚合（不分作品），看板头部展示用。 */
  outcomeStats: (): Promise<AgentOutcomeStats> => tauriApi.agentOutcomeStats(),
};
