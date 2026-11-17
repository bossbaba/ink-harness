import { tauriApi } from "@/api/tauri";
import type { ChapterContent, DraftVersion, DraftVersionBrief, SaveContentInput } from "@/types";

/**
 * 写作台领域服务：页面与组合式函数只依赖这个门面，不直接调 IPC。
 * 正文读写与版本快照是写作台独有能力，章节元数据的增删改仍归 outlineService。
 */
export const writingService = {
  getContent: (chapterId: string): Promise<ChapterContent> => tauriApi.getChapterContent(chapterId),

  saveContent: (input: SaveContentInput): Promise<ChapterContent> =>
    tauriApi.saveChapterContent(input),

  listVersions: (chapterId: string): Promise<DraftVersionBrief[]> =>
    tauriApi.listDraftVersions(chapterId),

  getVersion: (id: string): Promise<DraftVersion> => tauriApi.getDraftVersion(id),

  restoreVersion: (id: string): Promise<ChapterContent> => tauriApi.restoreDraftVersion(id),
};
