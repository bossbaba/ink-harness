import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { projectService } from "@/services/projectService";
import { writingService } from "@/services/writingService";
import { useDraftSyncStore } from "@/stores/draftSync";
import { serializeDraft } from "@/utils/draftPayload";
import { onReactivated } from "@/utils/lifecycle";
import { useWritingChapters } from "./useWritingChapters";
import { useWritingPersistence } from "./useWritingPersistence";
import { useWritingVersions } from "./useWritingVersions";

export type { SaveState } from "./useWritingPersistence";

/**
 * 写作台：章节列表 + 当前章正文 + 自动保存 + 版本快照。
 *
 * 正文防抖/备份/关窗守卫交给 useWritingPersistence，章节列表交给 useWritingChapters，
 * 版本交给 useWritingVersions；这里只负责把三者的作用域和章节切换串起来。
 *
 * 作用域约定：章节 id 来自路由（`/projects/:projectId/write/:chapterId`），
 * 组合式函数只负责「给定章节 id 就载入它」，不提供「默认选中第一章」这类回退，
 * 避免用户在不知道写的是哪一章的情况下开始敲字。
 */
export function useWritingDesk(projectId: string, currentChapterId: () => string) {
  const draftSync = useDraftSyncStore();
  const route = useRoute();
  const router = useRouter();
  const error = ref("");

  const chaptersApi = useWritingChapters(projectId, { error });
  const {
    project,
    chapters,
    chaptersLoading,
    actCount,
    totalWords,
    chaptersByAct,
    markDraftingStage,
    patchChapter,
    loadChapters,
    createChapter,
  } = chaptersApi;

  const content = ref("");
  const wordCount = ref(0);
  const contentLoading = ref(false);
  /** 供编辑器重新挂载用：切章或恢复版本时递增，让编辑器拿到新的初始内容。 */
  const editorRevision = ref(0);

  /** 载入正文的请求序号：连点两章时，只有最后一次请求的结果允许落到编辑器。 */
  let loadSeq = 0;
  /**
   * 每章「我读到的正文版本号」。按章节记在 Map 里而不是单个变量：
   * 切章时上一章可能还有一次补写，用当前章的版本去校验上一章会必然失败。
   */
  const contentRevisions = new Map<string, number>();
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

  const persistence = useWritingPersistence({
    projectId,
    loadedChapterId,
    content,
    wordCount,
    error,
    contentRevisions,
    patchChapter,
    markDraftingStage,
  });
  const {
    saveState,
    lastSavedAt,
    clearTimer,
    discardPending,
    waitForFlush,
    applyServerContent,
    onEditorUpdate,
    flush,
    installGuards,
  } = persistence;
  installGuards();

  /**
   * 从大纲页回到写作台时对齐章节与幕数。
   *
   * 两个页面各自被 keep-alive 缓存：大纲里新增/删除章节、新增幕，写作台不会重建，
   * 不重取就会一直显示旧列表（新章节看不见、删掉的章节还挂在列表里、新增的幕选不到）。
   */
  async function syncOutline(): Promise<void> {
    if (!projectId) return;
    await loadChapters({ silent: true });

    const chapterId = loadedChapterId.value;
    if (!chapterId) return;
    if (chapters.value.some((chapter) => chapter.id === chapterId)) return;

    // 正在写的章已在大纲里被删：正文没有可写的地方了，清掉载入状态并明确提示，
    // 否则用户继续敲字，自动保存只会在一个不存在的章节上反复失败。
    // 先等在飞保存结束再丢弃，免得刚丢掉又被失败的保存重新塞回队列。
    await waitForFlush();
    discardPending();
    contentRevisions.delete(chapterId);
    loadedChapterId.value = "";
    content.value = "";
    wordCount.value = 0;
    saveState.value = "idle";
    clearVersionCache();
    error.value = "这一章已在大纲中被删除，请在左侧重新选一章。";

    // 地址里还挂着已删除的章节 id 时一并摘掉，避免刷新/分享后回到一个不存在的章节。
    if (route.name === "project-writing") {
      void router.replace({ name: "project-writing", params: { projectId } });
    }
  }

  async function loadContent(chapterId: string): Promise<void> {
    clearTimer();
    // 重新载入就是「以库里为准」，解除冲突后的保存暂停。
    persistence.resetHalted();
    const seq = ++loadSeq;
    if (!chapterId) {
      loadedChapterId.value = "";
      content.value = "";
      wordCount.value = 0;
      saveState.value = "idle";
      clearVersionCache();
      return;
    }
    contentLoading.value = true;
    try {
      const data = await writingService.getContent(chapterId, projectId);
      // 连续点两章时先发的请求可能后返回：旧响应不能再覆盖当前章。
      if (seq !== loadSeq) return;
      loadedChapterId.value = chapterId;
      seenRevision = draftSync.revisionOf(chapterId);
      contentRevisions.set(chapterId, data.contentRevision);
      lastSavedAt.value = data.updatedAt;

      // 备份比库里的正文新就载入编辑器并提示保存，否则按库里的正文展示。
      applyServerContent(chapterId, data);
      editorRevision.value += 1;
      await loadVersions(chapterId);
      // 载入期间用户在旧章里继续敲的字属于旧章：交给 flush 落库，别跟着换章一起丢掉。
      const pending = persistence.getPending();
      if (pending && pending.chapterId !== chapterId) void flush();
    } catch (err) {
      if (seq !== loadSeq) return;
      // 载入失败时清掉「已载入章节」，避免用户对着旧正文继续写、却写到上一章去。
      loadedChapterId.value = "";
      content.value = "";
      wordCount.value = 0;
      error.value = `读取正文失败：${String(err)}`;
    } finally {
      // 只有最新一次载入才负责关掉加载态，否则旧请求会把新请求的 loading 提前关掉。
      if (seq === loadSeq) contentLoading.value = false;
    }
  }

  // 版本管理委托给独立 composable：注入自动保存桥接，避免两处各维护一份保存状态。
  const versionsApi = useWritingVersions({
    projectId,
    loadedChapterId,
    content,
    wordCount,
    saveState,
    lastSavedAt,
    editorRevision,
    contentRevisions,
    error,
    flush: () => flush(),
    // 版本模块只关心可落库的字符串；留一版快照时才在这里序列化一次。
    getPending: () => {
      const pending = persistence.getPending();
      return pending
        ? {
            chapterId: pending.chapterId,
            content: serializeDraft(pending),
            wordCount: pending.wordCount,
          }
        : null;
    },
    clearPending: () => persistence.setPending(null),
    clearHalted: () => persistence.resetHalted(),
    patchChapter,
  });
  const {
    versions,
    versionsLoading,
    snapshotBusy,
    restoreBusy,
    previewBusy,
    previewVersion,
    loadVersions,
    clearVersionCache,
    createSnapshot,
    openVersionPreview,
    closeVersionPreview,
    restoreVersion,
  } = versionsApi;

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
  });

  // 从缓存回来时做两件事：
  // 1) 大纲页可能在另一份缓存里增删了幕/章节，先对齐列表与幕数；
  // 2) 审稿页可能改过本章正文，版本对不上就丢弃缓存旧稿重读，
  //    避免自动保存把审稿结果覆盖回去。
  onReactivated(async () => {
    await syncOutline();

    const chapterId = loadedChapterId.value;
    if (!chapterId || draftSync.revisionOf(chapterId) === seenRevision) return;
    // 外部（审稿/工作流）改过正文：本地 pending 是过期的，重读前先让在飞保存结束再丢弃，
    // 否则丢弃的瞬间可能还有一次旧内容正在写库。
    await waitForFlush();
    discardPending();
    seenRevision = draftSync.revisionOf(chapterId);
    void loadContent(chapterId);
  });

  return {
    project,
    chapters,
    chaptersByAct,
    actCount,
    chaptersLoading,
    createChapter,
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
    snapshotBusy,
    restoreBusy,
    previewBusy,
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
