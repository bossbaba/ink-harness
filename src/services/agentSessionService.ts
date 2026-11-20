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
  /** 重命名会话：只改标题，作者可用它把「新对话」改成有辨识度的名字。 */
  rename: (id: string, title: string): Promise<void> => tauriApi.renameAgentSession(id, title),
  /** 删除会话：消息与轨迹一起删，删除前必须由界面二次确认。 */
  remove: (id: string): Promise<void> => tauriApi.deleteAgentSession(id),
};
