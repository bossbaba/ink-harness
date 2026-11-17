import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatChunk,
  ChatParams,
  ConsistencyIssue,
  DatabaseInfo,
  NewProject,
  NewStoryElement,
  OllamaStatus,
  Project,
  ProviderConfig,
  StoryElement,
  StoryElementOverview,
} from "@/types";

/** Tauri 命令的统一类型化封装，业务代码不直接调 invoke。 */

export const tauriApi = {
  ping: () => invoke<string>("ping"),

  listProviders: () => invoke<ProviderConfig[]>("list_providers"),
  saveProvider: (config: ProviderConfig) => invoke<void>("save_provider", { config }),
  removeProvider: (id: string) => invoke<void>("remove_provider", { id }),

  checkOllama: () => invoke<OllamaStatus>("check_ollama"),

  keychainSet: (key: string, value: string) => invoke<void>("keychain_set", { key, value }),
  keychainGet: (key: string) => invoke<string | null>("keychain_get", { key }),
  keychainDelete: (key: string) => invoke<void>("keychain_delete", { key }),

  databaseInfo: () => invoke<DatabaseInfo>("database_info"),
  listProjects: () => invoke<Project[]>("list_projects"),
  getProject: (id: string) => invoke<Project | null>("get_project", { id }),
  createProject: (input: NewProject) => invoke<Project>("create_project", { input }),
  updateProject: (project: Project) => invoke<void>("update_project", { project }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  listStoryElements: (projectId: string) =>
    invoke<StoryElement[]>("list_story_elements", { projectId }),
  listAllStoryElements: () => invoke<StoryElementOverview[]>("list_all_story_elements"),
  getStoryElement: (id: string) => invoke<StoryElement | null>("get_story_element", { id }),
  createStoryElement: (input: NewStoryElement) =>
    invoke<StoryElement>("create_story_element", { input }),
  updateStoryElement: (element: StoryElement) => invoke<void>("update_story_element", { element }),
  deleteStoryElement: (id: string) => invoke<void>("delete_story_element", { id }),
  checkStoryConsistency: (projectId: string) =>
    invoke<ConsistencyIssue[]>("check_story_consistency", { projectId }),

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
