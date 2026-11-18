import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { writingService } from "@/services/writingService";
import { useDraftSyncStore } from "@/stores/draftSync";
import { useProjectStore } from "@/stores/project";
import type {
  Act,
  Chapter,
  ChapterStatus,
  DraftVersion,
  DraftVersionBrief,
  Project,
} from "@/types";
import { clearDraftBackup, readDraftBackup, writeDraftBackup } from "@/utils/draftBackup";
import { onReactivated } from "@/utils/lifecycle";
import { countCharacters } from "@/utils/text";

/** 自动保存防抖间隔：太短会频繁写库，太长又容易在切章时丢刚写的内容。 */
const AUTOSAVE_DELAY = 1200;

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** 编辑器每次输入回调的内容载体。 */
export interface EditorPayload {
  /** TipTap 文档 JSON 字符串，直接落库。 */
  content: string;
  /** 编辑器纯文本，用来算字数。 */
  text: string;
}

/**
 * 写作台：章节列表 + 当前章正文 + 自动保存 + 版本快照。
 *
 * 作用域约定：章节 id 来自路由（`/projects/:projectId/write/:chapterId`），
 * 组合式函数只负责「给定章节 id 就载入它」，不提供「默认选中第一章」这类回退，
 * 避免用户在不知道写的是哪一章的情况下开始敲字。
 */
export function useWritingDesk(projectId: string, currentChapterId: () => string) {
  const draftSync = useDraftSyncStore();
  const route = useRoute();
  const router = useRouter();
  // 当前作品来自全局 store：别的页面改了作品状态，这里能立刻看到。
  const project = storeToRefs(useProjectStore()).current;
  const chapters = ref<Chapter[]>([]);
  const content = ref("");
  const wordCount = ref(0);
  const error = ref("");
  const chaptersLoading = ref(true);
  const contentLoading = ref(false);
  const saveState = ref<SaveState>("idle");
  const lastSavedAt = ref("");
  /** 供编辑器重新挂载用：切章或恢复版本时递增，让编辑器拿到新的初始内容。 */
  const editorRevision = ref(0);

  const versions = ref<DraftVersionBrief[]>([]);
  const versionsLoading = ref(false);
  const versionsBusy = ref(false);
  const previewVersion = ref<DraftVersion | null>(null);

  // 待落库的正文；自动保存与手动快照都从这里取，避免读到编辑器之外的旧值。
  let pending: { content: string; wordCount: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 是否已有一次保存在飞。
   * 保存期间用户继续输入时不再另起请求（那会让两次 save 落库顺序不确定，
   * 旧内容可能覆盖新内容），而是把内容留在 pending，由当前这一轮循环补写。
   */
  let saving = false;
  /** 载入正文时记住的版本：审稿页在外部改过正文后，靠它判断缓存是否已过期。 */
  let seenRevision = 0;

  const activeChapterId = computed(() => currentChapterId());
  /**
   * 已经载入正文的章节。自动保存只认这个 id：切章时路由参数会先变，
   * 若这时仍按路由 id 存，会把上一章刚写的内容写到新章节里去。
   */
  const loadedChapterId = ref("");
  const activeChapter = computed(
    () => chapters.value.find((chapter) => chapter.id === activeChapterId.value) ?? null,
  );
  const totalWords = computed(() =>
    chapters.value.reduce((sum, chapter) => sum + chapter.wordCount, 0),
  );
  const chaptersByAct = computed(() =>
    ([1, 2, 3] as Act[]).map((act) => ({
      act,
      chapters: chapters.value.filter((chapter) => chapter.act === act),
    })),
  );

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * 首次写出正文后，把作品阶段从「大纲」推进到「初稿」。
   * 阶段标签只是顶栏进度提示，写失败保持原状即可，不影响正文保存。
   */
  async function markDraftingStage(): Promise<void> {
    const current = project.value;
    if (current?.status !== "outline") return;
    try {
      const next: Project = { ...current, status: "drafting" };
      await projectService.update(next);
      project.value = next;
    } catch {
      // 忽略：阶段推进失败时用户仍能正常写作。
    }
  }

  /** 章节列表里的字数/状态就地更新，避免每次自动保存都重拉整份快照。 */
  function patchChapter(
    chapterId: string,
    patch: { wordCount?: number; status?: ChapterStatus; summary?: string },
  ) {
    chapters.value = chapters.value.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
    );
  }

  async function loadChapters(): Promise<void> {
    chaptersLoading.value = true;
    try {
      const snapshot = await outlineService.snapshot(projectId);
      chapters.value = snapshot.chapters;
    } catch (err) {
      error.value = `读取章节失败：${String(err)}`;
    } finally {
      chaptersLoading.value = false;
    }
  }

  async function loadVersions(chapterId: string): Promise<void> {
    if (!chapterId) {
      versions.value = [];
      return;
    }
    versionsLoading.value = true;
    try {
      versions.value = await writingService.listVersions(chapterId);
    } catch (err) {
      error.value = `读取版本失败：${String(err)}`;
    } finally {
      versionsLoading.value = false;
    }
  }

  async function loadContent(chapterId: string): Promise<void> {
    pending = null;
    clearTimer();
    if (!chapterId) {
      loadedChapterId.value = "";
      content.value = "";
      wordCount.value = 0;
      saveState.value = "idle";
      versions.value = [];
      return;
    }
    contentLoading.value = true;
    try {
      const data = await writingService.getContent(chapterId);
      loadedChapterId.value = chapterId;
      seenRevision = draftSync.revisionOf(chapterId);
      lastSavedAt.value = data.updatedAt;

      // 上次写库失败留下的本地备份如果比库里的正文更新，就载入编辑器并提示保存。
      // 直接丢弃等于把用户那一段文字吞掉；时间戳无法解析时也选择载入（宁可多写一次，不丢稿）。
      const backup = readDraftBackup(chapterId);
      const serverTime = Date.parse(data.updatedAt);
      const backupIsNewer =
        backup !== null && (!Number.isFinite(serverTime) || backup.savedAt > serverTime);
      if (backup && backupIsNewer) {
        content.value = backup.content;
        wordCount.value = backup.wordCount;
        saveState.value = "error";
        error.value = "检测到上次未保存的本地备份，已载入编辑器，请确认后保存。";
      } else {
        if (backup) clearDraftBackup(chapterId);
        content.value = data.content;
        wordCount.value = data.wordCount;
        saveState.value = "saved";
      }
      editorRevision.value += 1;
      await loadVersions(chapterId);
    } catch (err) {
      // 载入失败时清掉「已载入章节」，避免用户对着旧正文继续写、却写到上一章去。
      loadedChapterId.value = "";
      content.value = "";
      wordCount.value = 0;
      error.value = `读取正文失败：${String(err)}`;
    } finally {
      contentLoading.value = false;
    }
  }

  /** 编辑器输入：只更新字数与保存状态，落库交给防抖。 */
  function onEditorUpdate(payload: EditorPayload): void {
    const chapterId = loadedChapterId.value;
    if (!chapterId) return;
    pending = { content: payload.content, wordCount: countCharacters(payload.text) };
    wordCount.value = pending.wordCount;
    saveState.value = "dirty";
    clearTimer();
    timer = setTimeout(() => void flush(), AUTOSAVE_DELAY);
  }

  /**
   * 立即把待保存内容写库。
   * 切章、离开页面、手动快照前都会调用它，保证「界面上看到的字」已经落盘。
   *
   * 单飞：同一时刻只允许一个保存请求在飞；期间产生的新内容留在 pending，
   * 由本轮循环接着写一次。这样既不会并发覆盖，也不会丢字。
   */
  async function flush(): Promise<void> {
    clearTimer();
    if (saving) return;
    const chapterId = loadedChapterId.value;
    if (!chapterId || !pending) return;
    saving = true;
    saveState.value = "saving";
    try {
      while (pending) {
        const payload = pending;
        pending = null;
        const ok = await saveOnce(chapterId, payload);
        // 失败时内容已回到队列，这里必须停下：继续循环只会对同一个后端错误空转。
        if (!ok) break;
      }
    } finally {
      saving = false;
    }
  }

  /**
   * 写一次库，返回是否成功。
   * 失败时不抛异常（避免 `void flush()` 变成 unhandled rejection），
   * 而是把内容放回 pending 并标记 error，等下一次输入/切章/离开页面再试。
   */
  async function saveOnce(
    chapterId: string,
    payload: { content: string; wordCount: number },
  ): Promise<boolean> {
    try {
      const saved = await writingService.saveContent({
        chapterId,
        content: payload.content,
        wordCount: payload.wordCount,
      });
      // 章节列表按 id 更新，切章后也能正确反映上一章的新字数。
      patchChapter(chapterId, {
        wordCount: saved.wordCount,
        // 首次写出内容后，章节从「待写」推进到「写作中」；后端同样做了这一步。
        status: saved.wordCount > 0 ? "drafting" : undefined,
      });
      // 已落库，本地兜底备份就没用了，及时清掉避免下次载入误判。
      clearDraftBackup(chapterId);
      // 请求返回时用户可能已切到别的章节，此时旧结果不应覆盖当前页的状态栏。
      if (loadedChapterId.value !== chapterId) return true;
      wordCount.value = saved.wordCount;
      lastSavedAt.value = saved.updatedAt;
      saveState.value = "saved";
      if (saved.wordCount > 0) void markDraftingStage();
      return true;
    } catch (err) {
      // 期间用户又输入了新内容时优先保留新的那份，别让旧 payload 把它盖掉。
      if (!pending) pending = payload;
      // 写库失败时把正文留在本地，否则关窗/崩溃就真的丢了；下次载入该章会提示恢复。
      writeDraftBackup(chapterId, payload);
      saveState.value = "error";
      error.value = `保存失败：${String(err)}（正文已留在本地备份）`;
      return false;
    }
  }

  /** 手动留一版快照；先把编辑器里的最新内容写进去，否则快照会落后于屏幕。 */
  async function createSnapshot(): Promise<void> {
    const chapterId = loadedChapterId.value;
    if (!chapterId) return;
    versionsBusy.value = true;
    error.value = "";
    try {
      clearTimer();
      const payload = pending ?? { content: content.value, wordCount: wordCount.value };
      const saved = await writingService.saveContent({
        chapterId,
        content: payload.content,
        wordCount: payload.wordCount,
        snapshot: true,
      });
      pending = null;
      clearDraftBackup(chapterId);
      wordCount.value = saved.wordCount;
      lastSavedAt.value = saved.updatedAt;
      saveState.value = "saved";
      patchChapter(chapterId, {
        wordCount: saved.wordCount,
        status: saved.wordCount > 0 ? "drafting" : undefined,
      });
      await loadVersions(chapterId);
    } catch (err) {
      error.value = `保存快照失败：${String(err)}`;
    } finally {
      versionsBusy.value = false;
    }
  }

  /** 预览某一版：只取该版正文，不改动当前稿。 */
  async function openVersionPreview(versionId: string): Promise<void> {
    try {
      previewVersion.value = await writingService.getVersion(versionId);
    } catch (err) {
      error.value = `读取版本失败：${String(err)}`;
    }
  }

  function closeVersionPreview(): void {
    previewVersion.value = null;
  }

  /** 恢复到某一版：后端会先把当前正文补成底稿，这里只需把页面同步回旧内容。 */
  async function restoreVersion(versionId: string): Promise<void> {
    const chapterId = loadedChapterId.value;
    if (!chapterId) return;
    versionsBusy.value = true;
    error.value = "";
    try {
      clearTimer();
      pending = null;
      const restored = await writingService.restoreVersion(versionId);
      content.value = restored.content;
      wordCount.value = restored.wordCount;
      lastSavedAt.value = restored.updatedAt;
      saveState.value = "saved";
      editorRevision.value += 1;
      previewVersion.value = null;
      patchChapter(chapterId, { wordCount: restored.wordCount });
      await loadVersions(chapterId);
    } catch (err) {
      error.value = `恢复版本失败：${String(err)}`;
    } finally {
      versionsBusy.value = false;
    }
  }

  // 章节 id 变化（用户点列表或直接改地址）时，先把上一章未保存的内容写掉再载入新章。
  watch(
    () => currentChapterId(),
    async (next) => {
      if (!projectId) return;
      // 页面被 keep-alive 缓存后，从别的页面点侧栏「写作台」进来的路径不带章节 id：
      // 这时把上次载入的章补回路径，否则会按「未选章」把编辑器清空，看起来像丢了状态。
      // 只在写作台处于激活状态时补，避免人在别的页面却被改写地址。
      if (
        !next &&
        route.name === "project-writing" &&
        loadedChapterId.value &&
        chapters.value.some((chapter) => chapter.id === loadedChapterId.value)
      ) {
        void router.replace({
          name: "project-writing",
          params: { projectId, chapterId: loadedChapterId.value },
        });
        return;
      }
      // 补回同一个章节时不必重新读库，否则编辑器光标与滚动位置都会被重置。
      if (next === loadedChapterId.value) return;
      await flush();
      error.value = "";
      await loadContent(next);
    },
    { immediate: true },
  );

  // 切到后台/关闭窗口前补一次保存，桌面端没有可靠的 beforeunload 之外的时机。
  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") void flush();
  }

  onMounted(async () => {
    if (!projectId) {
      error.value = "缺少作品 ID，无法打开写作台。";
      chaptersLoading.value = false;
      return;
    }
    try {
      const found = await projectService.get(projectId);
      if (!found) {
        error.value = "作品不存在或已删除。";
        chaptersLoading.value = false;
        return;
      }
      project.value = found;
      await loadChapters();
    } catch (err) {
      error.value = `读取作品失败：${String(err)}`;
      chaptersLoading.value = false;
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    void flush();
  });

  // 页面被 keep-alive 缓存后，离开写作台走的是 deactivated 而不是 unmount：
  // 这里补一次落库，作者切到设定库/审稿时不用等自动保存的 2 秒。
  onDeactivated(() => void flush());

  // 审稿页把修改写进本章正文后，缓存里的编辑器内容就过期了。
  // 回来时若版本对不上，丢弃可能残留的旧稿直接重读，避免自动保存把审稿结果覆盖掉。
  onReactivated(() => {
    const chapterId = loadedChapterId.value;
    if (!chapterId || draftSync.revisionOf(chapterId) === seenRevision) return;
    pending = null;
    clearTimer();
    seenRevision = draftSync.revisionOf(chapterId);
    void loadContent(chapterId);
  });

  return {
    project,
    chapters,
    chaptersByAct,
    chaptersLoading,
    activeChapter,
    activeChapterId,
    loadedChapterId,
    content,
    contentLoading,
    wordCount,
    totalWords,
    error,
    saveState,
    lastSavedAt,
    editorRevision,
    versions,
    versionsLoading,
    versionsBusy,
    previewVersion,
    onEditorUpdate,
    patchChapter,
    flush,
    createSnapshot,
    openVersionPreview,
    closeVersionPreview,
    restoreVersion,
    loadVersions,
  };
}
