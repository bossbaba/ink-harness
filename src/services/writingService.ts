import { tauriApi } from "@/api/tauri";
import type { ChapterContent, DraftVersion, DraftVersionBrief, SaveContentInput } from "@/types";

/**
 * 写作台领域服务：页面与组合式函数只依赖这个门面，不直接调 IPC。
 * 正文读写与版本快照是写作台独有能力，章节元数据的增删改仍归 outlineService。
 *
 * 每个按 id 定位资源的方法都要求显式传 `projectId`，由后端再核一次归属。
 */
export const writingService = {
  getContent: (chapterId: string, projectId: string): Promise<ChapterContent> =>
    tauriApi.getChapterContent(chapterId, projectId),

  saveContent: (input: SaveContentInput, projectId: string): Promise<ChapterContent> =>
    tauriApi.saveChapterContent(input, projectId),

  listVersions: (chapterId: string, projectId: string): Promise<DraftVersionBrief[]> =>
    tauriApi.listDraftVersions(chapterId, projectId),

  getVersion: (id: string, projectId: string): Promise<DraftVersion> =>
    tauriApi.getDraftVersion(id, projectId),

  restoreVersion: (
    id: string,
    projectId: string,
    expectedContentRevision?: number,
  ): Promise<ChapterContent> =>
    tauriApi.restoreDraftVersion(id, projectId, expectedContentRevision),
};
