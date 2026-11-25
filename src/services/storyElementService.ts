import { tauriApi } from "@/api/tauri";
import type {
  ConsistencyIssue,
  NewStoryElement,
  StoryElement,
  StoryElementOverview,
} from "@/types";

/** 设定库领域服务：页面只依赖此门面，不直接调用 IPC。 */
export const storyElementService = {
  list: (projectId: string): Promise<StoryElement[]> => tauriApi.listStoryElements(projectId),

  /** 按 id 读单条设定；跨作品时后端按「查不到」返回 null。 */
  get: (id: string, projectId: string): Promise<StoryElement | null> =>
    tauriApi.getStoryElement(id, projectId),

  listAll: (): Promise<StoryElementOverview[]> => tauriApi.listAllStoryElements(),

  create: (input: NewStoryElement): Promise<StoryElement> => tauriApi.createStoryElement(input),

  update: (element: StoryElement, projectId: string): Promise<void> =>
    tauriApi.updateStoryElement(element, projectId),

  remove: (id: string, projectId: string): Promise<void> =>
    tauriApi.deleteStoryElement(id, projectId),

  checkConsistency: (projectId: string): Promise<ConsistencyIssue[]> =>
    tauriApi.checkStoryConsistency(projectId),
};
