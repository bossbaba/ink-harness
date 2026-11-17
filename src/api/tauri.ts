import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  Chapter,
  ChapterContent,
  ChatChunk,
  ChatParams,
  ConsistencyIssue,
  DatabaseInfo,
  DraftVersion,
  DraftVersionBrief,
  Foreshadow,
  MoveChapterInput,
  MoveSceneInput,
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
} from "@/types";

/**
 * Tauri 命令的统一类型化封装。
 * 业务层（service / composable）只调这里的方法，不直接散落 invoke 调用，
 * 好处是命令名与参数结构集中在一处，Rust 侧改名时只改这里。
 * 每个方法用泛型标注返回类型，拿到的数据从一开始就带正确类型。
 */
export const tauriApi = {
  // ping 用于探测后端是否就绪；工作台启动时调用，失败即展示「后端未就绪」。
  ping: () => invoke<string>("ping"),

  // Provider（模型服务）配置管理：增删查。密钥本体不在这里，走下面的 keychain。
  listProviders: () => invoke<ProviderConfig[]>("list_providers"),
  saveProvider: (config: ProviderConfig) => invoke<ProviderConfig>("save_provider", { config }),
  removeProvider: (id: string) => invoke<void>("remove_provider", { id }),
  // 探测服务地址并拉取模型列表；保存前也能用临时密钥测试。
  probeProvider: (input: ProbeProviderInput) => invoke<string[]>("probe_provider", { input }),

  // 探测本机 Ollama 是否安装/运行，以及已有哪些本地模型。
  checkOllama: () => invoke<OllamaStatus>("check_ollama"),
  // 从程序内拉起 Ollama（桌面版 App 或 ollama serve），后端等到服务可用才返回。
  startOllama: () => invoke<OllamaStatus>("start_ollama"),

  // 应用级设置：存在 app_meta 键值表，布尔值统一用 "1"/"0"。
  getAppSetting: (key: string) => invoke<string | null>("get_app_setting", { key }),
  setAppSetting: (key: string, value: string) => invoke<void>("set_app_setting", { key, value }),

  // 系统钥匙串读写：API 密钥只存引用键名，明文交由操作系统保管。
  keychainSet: (key: string, value: string) => invoke<void>("keychain_set", { key, value }),
  keychainGet: (key: string) => invoke<string | null>("keychain_get", { key }),
  keychainDelete: (key: string) => invoke<void>("keychain_delete", { key }),

  // 作品 CRUD。getProject 找不到时返回 null，由调用方决定如何提示。
  databaseInfo: () => invoke<DatabaseInfo>("database_info"),
  listProjects: () => invoke<Project[]>("list_projects"),
  getProject: (id: string) => invoke<Project | null>("get_project", { id }),
  createProject: (input: NewProject) => invoke<Project>("create_project", { input }),
  updateProject: (project: Project) => invoke<void>("update_project", { project }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  // 设定条目 CRUD。listStoryElements 限定单部作品，listAllStoryElements 跨作品汇总。
  listStoryElements: (projectId: string) =>
    invoke<StoryElement[]>("list_story_elements", { projectId }),
  listAllStoryElements: () => invoke<StoryElementOverview[]>("list_all_story_elements"),
  getStoryElement: (id: string) => invoke<StoryElement | null>("get_story_element", { id }),
  createStoryElement: (input: NewStoryElement) =>
    invoke<StoryElement>("create_story_element", { input }),
  updateStoryElement: (element: StoryElement) => invoke<void>("update_story_element", { element }),
  deleteStoryElement: (id: string) => invoke<void>("delete_story_element", { id }),
  // 一致性检查按作品维度执行，返回该作品下所有可疑问题。
  checkStoryConsistency: (projectId: string) =>
    invoke<ConsistencyIssue[]>("check_story_consistency", { projectId }),

  // 大纲看板：一次拉全量快照，之后所有增删改都走细粒度命令并重新取快照。
  outlineSnapshot: (projectId: string) =>
    invoke<OutlineSnapshot>("outline_snapshot", { projectId }),
  createChapter: (input: NewChapter) => invoke<Chapter>("create_chapter", { input }),
  updateChapter: (chapter: Chapter) => invoke<void>("update_chapter", { chapter }),
  deleteChapter: (id: string) => invoke<void>("delete_chapter", { id }),
  createScene: (input: NewScene) => invoke<Scene>("create_scene", { input }),
  updateScene: (scene: Scene) => invoke<void>("update_scene", { scene }),
  deleteScene: (id: string) => invoke<void>("delete_scene", { id }),
  createForeshadow: (input: NewForeshadow) => invoke<Foreshadow>("create_foreshadow", { input }),
  updateForeshadow: (foreshadow: Foreshadow) => invoke<void>("update_foreshadow", { foreshadow }),
  deleteForeshadow: (id: string) => invoke<void>("delete_foreshadow", { id }),
  moveChapter: (input: MoveChapterInput) => invoke<void>("move_chapter", { input }),
  moveScene: (input: MoveSceneInput) => invoke<void>("move_scene", { input }),
  buildProjectContext: (projectId: string) =>
    invoke<string>("build_project_context", { projectId }),

  // 写作台：章节正文按章读取/保存，版本快照单独一组命令。
  getChapterContent: (chapterId: string) =>
    invoke<ChapterContent>("get_chapter_content", { chapterId }),
  saveChapterContent: (input: SaveContentInput) =>
    invoke<ChapterContent>("save_chapter_content", { input }),
  listDraftVersions: (chapterId: string) =>
    invoke<DraftVersionBrief[]>("list_draft_versions", { chapterId }),
  getDraftVersion: (id: string) => invoke<DraftVersion>("get_draft_version", { id }),
  restoreDraftVersion: (id: string) => invoke<ChapterContent>("restore_draft_version", { id }),

  // RAG 检索：索引按作品维护，检索按问题取最近片段。
  ragStatus: (projectId: string) => invoke<RagStatus>("rag_status", { projectId }),
  ragReindex: (projectId: string) => invoke<RagStatus>("rag_reindex", { projectId }),
  ragSearch: (projectId: string, query: string, limit?: number) =>
    invoke<RagHit[]>("rag_search", { projectId, query, limit }),

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
    return invoke<void>("chat_completions", { params, onChunk: channel }).catch((err) => {
      onError?.(String(err));
    });
  },
};
