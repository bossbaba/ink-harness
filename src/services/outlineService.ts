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
  removeChapter: (id: string): Promise<void> => tauriApi.deleteChapter(id),

  createScene: (input: NewScene): Promise<Scene> => tauriApi.createScene(input),
  updateScene: (scene: Scene): Promise<void> => tauriApi.updateScene(scene),
  removeScene: (id: string): Promise<void> => tauriApi.deleteScene(id),

  createForeshadow: (input: NewForeshadow): Promise<Foreshadow> => tauriApi.createForeshadow(input),
  updateForeshadow: (foreshadow: Foreshadow): Promise<void> =>
    tauriApi.updateForeshadow(foreshadow),
  removeForeshadow: (id: string): Promise<void> => tauriApi.deleteForeshadow(id),

  moveChapter: (input: MoveChapterInput): Promise<void> => tauriApi.moveChapter(input),
  moveScene: (input: MoveSceneInput): Promise<void> => tauriApi.moveScene(input),

  buildContext: (projectId: string): Promise<string> => tauriApi.buildProjectContext(projectId),
};
