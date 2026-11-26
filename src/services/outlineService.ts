import { tauriApi } from "@/api/tauri";
import type {
  Chapter,
  Foreshadow,
  MoveChapterInput,
  MoveSceneInput,
  NewChapter,
  NewForeshadow,
  NewScene,
  OutlineSnapshot,
  Scene,
} from "@/types";

/** 大纲领域服务：页面只依赖此门面，不直接调用 IPC。 */
export const outlineService = {
  snapshot: (projectId: string): Promise<OutlineSnapshot> => tauriApi.outlineSnapshot(projectId),

  createChapter: (input: NewChapter): Promise<Chapter> => tauriApi.createChapter(input),
  updateChapter: (chapter: Chapter): Promise<void> => tauriApi.updateChapter(chapter),
  updateChapterSummary: (id: string, summary: string, projectId: string): Promise<void> =>
    tauriApi.updateChapterSummary(id, summary, projectId),
  removeChapter: (id: string, projectId: string): Promise<void> =>
    tauriApi.deleteChapter(id, projectId),

  createScene: (input: NewScene, projectId: string): Promise<Scene> =>
    tauriApi.createScene(input, projectId),
  updateScene: (scene: Scene, projectId: string): Promise<void> =>
    tauriApi.updateScene(scene, projectId),
  removeScene: (id: string, projectId: string): Promise<void> =>
    tauriApi.deleteScene(id, projectId),

  createForeshadow: (input: NewForeshadow): Promise<Foreshadow> => tauriApi.createForeshadow(input),
  updateForeshadow: (foreshadow: Foreshadow): Promise<void> =>
    tauriApi.updateForeshadow(foreshadow),
  removeForeshadow: (id: string, projectId: string): Promise<void> =>
    tauriApi.deleteForeshadow(id, projectId),

  moveChapter: (input: MoveChapterInput): Promise<void> => tauriApi.moveChapter(input),
  moveScene: (input: MoveSceneInput, projectId: string): Promise<void> =>
    tauriApi.moveScene(input, projectId),

  buildContext: (projectId: string): Promise<string> => tauriApi.buildProjectContext(projectId),
};
