import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AgentMessageRecord,
  AgentSession,
  AgentStepRecord,
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
  MoveChapterInput,
  MoveSceneInput,
  NewAgentMessage,
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

  // 系统钥匙串：只有写入与删除。读取明文的命令在后端刻意不提供，
  // 前端一律通过 apiKeyRef 交由 Rust 侧使用，避免密钥泄漏到渲染进程。
  keychainSet: (key: string, value: string) => call<void>("keychain_set", { key, value }),
  keychainDelete: (key: string) => call<void>("keychain_delete", { key }),

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
  getStoryElement: (id: string) => call<StoryElement | null>("get_story_element", { id }),
  createStoryElement: (input: NewStoryElement) =>
    call<StoryElement>("create_story_element", { input }),
  updateStoryElement: (element: StoryElement) => call<void>("update_story_element", { element }),
  deleteStoryElement: (id: string) => call<void>("delete_story_element", { id }),
  // 一致性检查按作品维度执行，返回该作品下所有可疑问题。
  checkStoryConsistency: (projectId: string) =>
    call<ConsistencyIssue[]>("check_story_consistency", { projectId }),

  // 大纲看板：一次拉全量快照，之后所有增删改都走细粒度命令并重新取快照。
  outlineSnapshot: (projectId: string) => call<OutlineSnapshot>("outline_snapshot", { projectId }),
  createChapter: (input: NewChapter) => call<Chapter>("create_chapter", { input }),
  updateChapter: (chapter: Chapter) => call<void>("update_chapter", { chapter }),
  /** 只改摘要：避免摘要自动保存把标题/幕次/状态一起整对象覆盖。 */
  updateChapterSummary: (id: string, summary: string) =>
    call<void>("update_chapter_summary", { id, summary }),
  deleteChapter: (id: string) => call<void>("delete_chapter", { id }),
  createScene: (input: NewScene) => call<Scene>("create_scene", { input }),
  updateScene: (scene: Scene) => call<void>("update_scene", { scene }),
  deleteScene: (id: string) => call<void>("delete_scene", { id }),
  createForeshadow: (input: NewForeshadow) => call<Foreshadow>("create_foreshadow", { input }),
  updateForeshadow: (foreshadow: Foreshadow) => call<void>("update_foreshadow", { foreshadow }),
  deleteForeshadow: (id: string) => call<void>("delete_foreshadow", { id }),
  moveChapter: (input: MoveChapterInput) => call<void>("move_chapter", { input }),
  moveScene: (input: MoveSceneInput) => call<void>("move_scene", { input }),
  buildProjectContext: (projectId: string) => call<string>("build_project_context", { projectId }),

  // 写作台：章节正文按章读取/保存，版本快照单独一组命令。
  getChapterContent: (chapterId: string) =>
    call<ChapterContent>("get_chapter_content", { chapterId }),
  saveChapterContent: (input: SaveContentInput) =>
    call<ChapterContent>("save_chapter_content", { input }),
  listDraftVersions: (chapterId: string) =>
    call<DraftVersionBrief[]>("list_draft_versions", { chapterId }),
  getDraftVersion: (id: string) => call<DraftVersion>("get_draft_version", { id }),
  restoreDraftVersion: (id: string) => call<ChapterContent>("restore_draft_version", { id }),

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

  // RAG 检索：索引按作品维护，检索按问题取最近片段。
  ragStatus: (projectId: string) => call<RagStatus>("rag_status", { projectId }),
  ragReindex: (projectId: string) => call<RagStatus>("rag_reindex", { projectId }),
  ragSearch: (projectId: string, query: string, limit?: number) =>
    call<RagHit[]>("rag_search", { projectId, query, limit }),

  /**
   * 流式对话：创建 Channel 逐块接收。
   * Channel 在 Rust 命令返回（或出错）时自动清理，无需前端手动关闭。
   * 中途取消将在后续阶段通过取消令牌实现（Tauri Channel 无公开 close）。
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
};
