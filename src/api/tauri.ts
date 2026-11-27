import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AgentEvalRun,
  AgentMessageRecord,
  AgentOutcomeStats,
  AgentRole,
  AgentSession,
  AgentStepRecord,
  ApplyWorkflowInput,
  Chapter,
  ChapterContent,
  ChatChunk,
  ChatParams,
  ConsistencyIssue,
  DatabaseInfo,
  DraftVersion,
  DraftVersionBrief,
  ExportResult,
  Foreshadow,
  IdeationDraftRow,
  IdeationDraftRowInput,
  McpServerConfig,
  McpToolInfo,
  MoveChapterInput,
  MoveSceneInput,
  NewAgentEvalRun,
  NewAgentMessage,
  NewAgentRole,
  NewAgentSession,
  NewAgentStep,
  NewChapter,
  NewForeshadow,
  NewProject,
  NewScene,
  NewStoryElement,
  OllamaStatus,
  OutlineSnapshot,
  ProbeProviderInput,
  Project,
  ProviderConfig,
  RagHit,
  RagStatus,
  SaveContentInput,
  Scene,
  StoryElement,
  StoryElementOverview,
  UsageStats,
  WorkspaceStats,
} from "@/types";
import { BackendError, normalizeError } from "@/utils/errors";

/** 原始 Tauri 调用，不做错误包装，只允许 `call` 使用。 */
const rawInvoke = invoke;

/**
 * 统一收口所有 invoke 调用：把后端的 `{ code, message }` 转成 `BackendError`。
 *
 * 这里刻意不做全局提示——展示位置由调用方决定（页面内的 error 位更贴近操作）。
 * 万一没人接这个 rejection，`main.ts` 的 unhandledrejection 会用全局提示栈兜住。
 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await rawInvoke<T>(command, args);
  } catch (err) {
    const { code, message } = normalizeError(err);
    throw new BackendError(message, code);
  }
}

/**
 * Tauri 命令的统一类型化封装。
 * 业务层（service / composable）只调这里的方法，不直接散落 invoke 调用，
 * 好处是命令名与参数结构集中在一处，Rust 侧改名时只改这里。
 * 每个方法用泛型标注返回类型，拿到的数据从一开始就带正确类型。
 */
export const tauriApi = {
  // ping 用于探测后端是否就绪；工作台启动时调用，失败即展示「后端未就绪」。
  ping: () => call<string>("ping"),

  // Provider（模型服务）配置管理：增删查。密钥本体不在这里，走下面的 keychain。
  listProviders: () => call<ProviderConfig[]>("list_providers"),
  saveProvider: (config: ProviderConfig) => call<ProviderConfig>("save_provider", { config }),
  removeProvider: (id: string) => call<void>("remove_provider", { id }),
  // 探测服务地址并拉取模型列表；保存前也能用临时密钥测试。
  probeProvider: (input: ProbeProviderInput) => call<string[]>("probe_provider", { input }),

  // 探测本机 Ollama 是否安装/运行，以及已有哪些本地模型。
  checkOllama: () => call<OllamaStatus>("check_ollama"),
  // 从程序内拉起 Ollama（桌面版 App 或 ollama serve），后端等到服务可用才返回。
  startOllama: () => call<OllamaStatus>("start_ollama"),

  // 应用级设置：存在 app_meta 键值表，布尔值统一用 "1"/"0"。
  getAppSetting: (key: string) => call<string | null>("get_app_setting", { key }),
  setAppSetting: (key: string, value: string) => call<void>("set_app_setting", { key, value }),

  // 工作流审批：正文与阶段状态在 Rust 侧同一事务提交，失败整体回滚。
  applyWorkflow: (input: ApplyWorkflowInput) => call<void>("apply_workflow", { input }),

  // 系统钥匙串：明文只写不读；keychainHas 只回布尔值，用来校准界面上的「已保存密钥」。
  // 前端一律通过 apiKeyRef 交由 Rust 侧使用，避免密钥泄漏到渲染进程。
  keychainSet: (key: string, value: string) => call<void>("keychain_set", { key, value }),
  keychainDelete: (key: string) => call<void>("keychain_delete", { key }),
  keychainHas: (key: string) => call<boolean>("keychain_has", { key }),

  // 作品 CRUD。getProject 找不到时返回 null，由调用方决定如何提示。
  databaseInfo: () => call<DatabaseInfo>("database_info"),
  listProjects: () => call<Project[]>("list_projects"),
  getProject: (id: string) => call<Project | null>("get_project", { id }),
  createProject: (input: NewProject) => call<Project>("create_project", { input }),
  updateProject: (project: Project) => call<void>("update_project", { project }),
  deleteProject: (id: string) => call<void>("delete_project", { id }),

  // 设定条目 CRUD。listStoryElements 限定单部作品，listAllStoryElements 跨作品汇总。
  listStoryElements: (projectId: string) =>
    call<StoryElement[]>("list_story_elements", { projectId }),
  listAllStoryElements: () => call<StoryElementOverview[]>("list_all_story_elements"),
  getStoryElement: (id: string, projectId: string) =>
    call<StoryElement | null>("get_story_element", { id, projectId }),
  createStoryElement: (input: NewStoryElement) =>
    call<StoryElement>("create_story_element", { input }),
  updateStoryElement: (element: StoryElement, projectId: string) =>
    call<void>("update_story_element", { element, projectId }),
  deleteStoryElement: (id: string, projectId: string) =>
    call<void>("delete_story_element", { id, projectId }),
  // 一致性检查按作品维度执行，返回该作品下所有可疑问题。
  checkStoryConsistency: (projectId: string) =>
    call<ConsistencyIssue[]>("check_story_consistency", { projectId }),

  // 大纲看板：一次拉全量快照，之后所有增删改都走细粒度命令并重新取快照。
  outlineSnapshot: (projectId: string) => call<OutlineSnapshot>("outline_snapshot", { projectId }),
  createChapter: (input: NewChapter) => call<Chapter>("create_chapter", { input }),
  updateChapter: (chapter: Chapter) => call<void>("update_chapter", { chapter }),
  /** 只改摘要：避免摘要自动保存把标题/幕次/状态一起整对象覆盖。 */
  updateChapterSummary: (id: string, summary: string, projectId: string) =>
    call<void>("update_chapter_summary", { id, summary, projectId }),
  deleteChapter: (id: string, projectId: string) => call<void>("delete_chapter", { id, projectId }),
  createScene: (input: NewScene, projectId: string) =>
    call<Scene>("create_scene", { input, projectId }),
  updateScene: (scene: Scene, projectId: string) =>
    call<void>("update_scene", { scene, projectId }),
  deleteScene: (id: string, projectId: string) => call<void>("delete_scene", { id, projectId }),
  createForeshadow: (input: NewForeshadow) => call<Foreshadow>("create_foreshadow", { input }),
  updateForeshadow: (foreshadow: Foreshadow) => call<void>("update_foreshadow", { foreshadow }),
  deleteForeshadow: (id: string, projectId: string) =>
    call<void>("delete_foreshadow", { id, projectId }),
  moveChapter: (input: MoveChapterInput) => call<void>("move_chapter", { input }),
  moveScene: (input: MoveSceneInput, projectId: string) =>
    call<void>("move_scene", { input, projectId }),
  buildProjectContext: (projectId: string) => call<string>("build_project_context", { projectId }),

  // 写作台：章节正文按章读取/保存，版本快照单独一组命令。
  getChapterContent: (chapterId: string, projectId: string) =>
    call<ChapterContent>("get_chapter_content", { chapterId, projectId }),
  saveChapterContent: (input: SaveContentInput, projectId: string) =>
    call<ChapterContent>("save_chapter_content", { input, projectId }),
  listDraftVersions: (chapterId: string, projectId: string) =>
    call<DraftVersionBrief[]>("list_draft_versions", { chapterId, projectId }),
  getDraftVersion: (id: string, projectId: string) =>
    call<DraftVersion>("get_draft_version", { id, projectId }),
  restoreDraftVersion: (id: string, projectId: string, expectedContentRevision?: number) =>
    call<ChapterContent>("restore_draft_version", { id, projectId, expectedContentRevision }),

  // 出版导出：内容在前端生成，这里只把字节写到用户选定的路径。
  writeExportFile: (path: string, data: number[]) =>
    call<ExportResult>("write_export_file", { path, data }),

  // 用量看板：token 在流式响应结束时由 Rust 记入 agent_run。
  usageStats: () => call<UsageStats>("usage_stats"),

  // 全局统计：跨作品汇总作品/章节/字数/设定，只读。
  workspaceStats: () => call<WorkspaceStats>("workspace_stats"),

  // Agent 会话与轨迹：会话记忆与运行回放。
  createAgentSession: (input: NewAgentSession) =>
    call<AgentSession>("create_agent_session", { input }),
  listAgentSessions: (projectId: string) =>
    call<AgentSession[]>("list_agent_sessions", { projectId }),
  appendAgentMessage: (input: NewAgentMessage) => call<void>("append_agent_message", { input }),
  listAgentMessages: (sessionId: string) =>
    call<AgentMessageRecord[]>("list_agent_messages", { sessionId }),
  appendAgentStep: (input: NewAgentStep) => call<void>("append_agent_step", { input }),
  listAgentSteps: (projectId: string) => call<AgentStepRecord[]>("list_agent_steps", { projectId }),
  agentOutcomeStats: () => call<AgentOutcomeStats>("agent_outcome_stats"),
  // 会话管理：重命名与删除，补齐 CRUD 里的 U/D。
  renameAgentSession: (id: string, title: string) =>
    call<void>("rename_agent_session", { id, title }),
  deleteAgentSession: (id: string) => call<void>("delete_agent_session", { id }),

  // Agent 角色：prompt + 工具白名单，不绑定模型。
  listAgentRoles: () => call<AgentRole[]>("list_agent_roles"),
  saveAgentRole: (input: NewAgentRole) => call<AgentRole>("save_agent_role", { input }),
  deleteAgentRole: (id: string) => call<void>("delete_agent_role", { id }),

  // MCP 外部工具：配置走 app_meta，工具发现/调用由后端 spawn stdio server。
  listMcpServers: () => call<McpServerConfig[]>("list_mcp_servers"),
  saveMcpServer: (input: McpServerConfig) => call<McpServerConfig[]>("save_mcp_server", { input }),
  removeMcpServer: (id: string) => call<McpServerConfig[]>("remove_mcp_server", { id }),
  listMcpTools: () => call<McpToolInfo[]>("list_mcp_tools"),
  // 内置默认工具（联网搜索）：开关存 app_meta，不占用外部 server 配置。
  getBuiltinWebSearch: () => call<boolean>("get_builtin_web_search"),
  setBuiltinWebSearch: (enabled: boolean) => call<boolean>("set_builtin_web_search", { enabled }),
  callMcpTool: (
    name: string,
    args: Record<string, unknown>,
    projectId: string,
    sessionId: string,
    approvalToken: string,
  ) =>
    call<string>("call_mcp_tool", {
      name,
      arguments: args,
      projectId,
      sessionId,
      approvalToken,
    }),
  issueMcpApproval: (
    tool: string,
    args: Record<string, unknown>,
    projectId: string,
    sessionId: string,
  ) => call<string>("issue_mcp_approval", { tool, arguments: args, projectId, sessionId }),

  // 评测结果：跑分在前端做，这里只存取汇总与明细。
  saveAgentEvalRun: (input: NewAgentEvalRun) =>
    call<AgentEvalRun>("save_agent_eval_run", { input }),
  // projectId 传入时只拉该作品的跑分，避免切作品后历史混在一起。
  listAgentEvalRuns: (limit = 20, projectId?: string) =>
    call<AgentEvalRun[]>("list_agent_eval_runs", { limit, projectId: projectId ?? null }),

  // 构思向导草稿：按作品存一份，答案与方案以 JSON 字符串传输。
  loadIdeationDraft: (projectId: string) =>
    call<IdeationDraftRow | null>("load_ideation_draft", { projectId }),
  saveIdeationDraft: (input: IdeationDraftRowInput) =>
    call<IdeationDraftRow>("save_ideation_draft", { input }),

  // RAG 检索：索引按作品维护，检索按问题取最近片段。
  ragStatus: (projectId: string) => call<RagStatus>("rag_status", { projectId }),
  ragReindex: (projectId: string) => call<RagStatus>("rag_reindex", { projectId }),
  ragSearch: (projectId: string, query: string, limit?: number) =>
    call<RagHit[]>("rag_search", { projectId, query, limit }),

  /**
   * 流式对话：创建 Channel 逐块接收。
   * Channel 在 Rust 命令返回（或出错）时自动清理，无需前端手动关闭。
   * 中途取消走 `cancelChat(requestId)`——Tauri Channel 没有公开的 close()。
   */
  chat: (
    params: ChatParams,
    onChunk: (chunk: ChatChunk) => void,
    onError?: (error: string) => void,
  ): Promise<void> => {
    const channel = new Channel<ChatChunk>();
    channel.onmessage = onChunk;
    return call<void>("chat_completions", { params, onChunk: channel }).catch((err) => {
      // 失败必须回调出去：模型路由依赖它把「无可用模型/隐私拦截」等错误落到界面上。
      onError?.(normalizeError(err).message);
    });
  },

  /**
   * 停止指定请求：后端置位取消标志，网关在读流/等待首字处主动断开上游连接。
   * 幂等操作——请求已正常结束时标志已注销，这次调用什么也不做。
   */
  cancelChat: (requestId: string) => call<void>("cancel_chat", { requestId }),
};

/**
 * 注册关窗守卫：有未保存内容时先让调用方落盘，再销毁窗口。
 *
 * 原生窗口 API 只在这一层用，业务 composable 不直接 import `@tauri-apps/*`；
 * 浏览器预览与单测环境没有 Tauri 内部对象，直接返回空操作，行为与以前一致。
 */
export async function guardWindowClose(
  hasUnsaved: () => boolean,
  onGuardedClose: () => Promise<void>,
): Promise<() => void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return () => {};
  }
  const win = getCurrentWindow();
  return win.onCloseRequested(async (event) => {
    if (!hasUnsaved()) return;
    event.preventDefault();
    await onGuardedClose();
    await win.destroy();
  });
}
