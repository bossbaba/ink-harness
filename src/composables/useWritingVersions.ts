import { type Ref, ref } from "vue";
import { writingService } from "@/services/writingService";
import type { ChapterStatus, DraftVersion, DraftVersionBrief } from "@/types";
import { clearDraftBackup } from "@/utils/draftBackup";
import type { SaveState } from "./useWritingDesk";

/**
 * 写作台的草稿版本管理：版本列表、快照、预览与恢复。
 *
 * 从 useWritingDesk 拆出以控制单文件规模。版本操作要在保存/恢复前
 * 串行化在飞保存，因此通过依赖对象拿到写入桥接（flush / pending / 版本号表），
 * 不自行持有自动保存状态，避免两处各写一份导致冲突。
 */
export interface WritingVersionDeps {
  /** 当前已载入正文的章节 id。 */
  loadedChapterId: Ref<string>;
  /** 编辑器正文（含未保存改动）。 */
  content: Ref<string>;
  /** 当前正文字数。 */
  wordCount: Ref<number>;
  /** 保存状态展示。 */
  saveState: Ref<SaveState>;
  /** 最近保存时间展示。 */
  lastSavedAt: Ref<string>;
  /** 编辑器重建计数，恢复版本后 +1 让编辑器重载。 */
  editorRevision: Ref<number>;
  /** 每章「我读到的正文版本号」，快照/恢复写入新版本号。 */
  contentRevisions: Map<string, number>;
  /** 共享错误文案。 */
  error: Ref<string>;
  /** 等待在飞保存落库。 */
  flush: () => Promise<void>;
  /** 读取待落库内容（未被本轮消费）。 */
  getPending: () => { chapterId: string; content: string; wordCount: number } | null;
  /** 清空待落库内容。 */
  clearPending: () => void;
  /** 解除版本冲突后的保存暂停。 */
  clearHalted: () => void;
  /** 章节列表就地更新（字数/状态）。 */
  patchChapter: (
    chapterId: string,
    patch: { wordCount?: number; status?: ChapterStatus; summary?: string },
  ) => void;
}

export function useWritingVersions(deps: WritingVersionDeps) {
  const versions = ref<DraftVersionBrief[]>([]);
  const versionsLoading = ref(false);
  // 快照与恢复分开：共用一个 busy 会让「保存快照」在恢复时也转圈，指向错误的操作。
  const snapshotBusy = ref(false);
  const restoreBusy = ref(false);
  const previewVersion = ref<DraftVersion | null>(null);

  async function loadVersions(chapterId: string): Promise<void> {
    if (!chapterId) {
      versions.value = [];
      return;
    }
    versionsLoading.value = true;
    try {
      versions.value = await writingService.listVersions(chapterId);
    } catch (err) {
      deps.error.value = `读取版本失败：${String(err)}`;
    } finally {
      versionsLoading.value = false;
    }
  }

  /** 清空版本缓存：切章/大纲回流时旧章的版本列表不能留在新章界面上。 */
  function clearVersionCache(): void {
    versions.value = [];
    previewVersion.value = null;
  }

  /** 手动留一版快照；先把编辑器里的最新内容写进去，否则快照会落后于屏幕。 */
  async function createSnapshot(): Promise<void> {
    const chapterId = deps.loadedChapterId.value;
    if (!chapterId) return;
    snapshotBusy.value = true;
    deps.error.value = "";
    try {
      // 先等自动保存落完，避免快照与在飞的那次保存互相覆盖。
      await deps.flush();
      // flush 之后 pending 通常已空；若上次写库失败还留着，就用它（内容比 content ref 更新）。
      const left = deps.getPending();
      const payload =
        left && left.chapterId === chapterId
          ? left
          : {
              chapterId,
              content: deps.content.value,
              wordCount: deps.wordCount.value,
            };
      const saved = await writingService.saveContent({
        chapterId,
        content: payload.content,
        wordCount: payload.wordCount,
        snapshot: true,
        expectedContentRevision: deps.contentRevisions.get(chapterId),
      });
      deps.contentRevisions.set(chapterId, saved.contentRevision);
      deps.clearPending();
      clearDraftBackup(chapterId);
      deps.wordCount.value = saved.wordCount;
      deps.lastSavedAt.value = saved.updatedAt;
      deps.saveState.value = "saved";
      deps.patchChapter(chapterId, {
        wordCount: saved.wordCount,
        status: saved.wordCount > 0 ? "drafting" : undefined,
      });
      await loadVersions(chapterId);
    } catch (err) {
      deps.error.value = `保存快照失败：${String(err)}`;
    } finally {
      snapshotBusy.value = false;
    }
  }

  /** 预览某一版：只取该版正文，不改动当前稿。 */
  async function openVersionPreview(versionId: string): Promise<void> {
    try {
      previewVersion.value = await writingService.getVersion(versionId);
    } catch (err) {
      deps.error.value = `读取版本失败：${String(err)}`;
    }
  }

  function closeVersionPreview(): void {
    previewVersion.value = null;
  }

  /** 恢复到某一版：后端会先把当前正文补成底稿，这里只需把页面同步回旧内容。 */
  async function restoreVersion(versionId: string): Promise<void> {
    const chapterId = deps.loadedChapterId.value;
    if (!chapterId) return;
    restoreBusy.value = true;
    deps.error.value = "";
    try {
      // 恢复会整篇覆盖正文：先把未落库的输入写下去（失败时 flush 已留本地备份），
      // 否则这段文字会被恢复操作无声吃掉。
      await deps.flush();
      deps.clearPending();
      const restored = await writingService.restoreVersion(versionId);
      deps.content.value = restored.content;
      deps.wordCount.value = restored.wordCount;
      deps.contentRevisions.set(chapterId, restored.contentRevision);
      deps.lastSavedAt.value = restored.updatedAt;
      deps.saveState.value = "saved";
      // 恢复后库里的版本已经换成这一版，之前的冲突自然解除。
      deps.clearHalted();
      deps.editorRevision.value += 1;
      previewVersion.value = null;
      deps.patchChapter(chapterId, { wordCount: restored.wordCount });
      await loadVersions(chapterId);
    } catch (err) {
      deps.error.value = `恢复版本失败：${String(err)}`;
    } finally {
      restoreBusy.value = false;
    }
  }

  return {
    versions,
    versionsLoading,
    snapshotBusy,
    restoreBusy,
    previewVersion,
    loadVersions,
    clearVersionCache,
    createSnapshot,
    openVersionPreview,
    closeVersionPreview,
    restoreVersion,
  };
}
