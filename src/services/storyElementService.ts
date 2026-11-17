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

  get: (id: string): Promise<StoryElement | null> => tauriApi.getStoryElement(id),

  listAll: (): Promise<StoryElementOverview[]> => tauriApi.listAllStoryElements(),

  create: (input: NewStoryElement): Promise<StoryElement> => tauriApi.createStoryElement(input),

  update: (element: StoryElement): Promise<void> => tauriApi.updateStoryElement(element),

  remove: (id: string): Promise<void> => tauriApi.deleteStoryElement(id),

  checkConsistency: (projectId: string): Promise<ConsistencyIssue[]> =>
    tauriApi.checkStoryConsistency(projectId),
};
