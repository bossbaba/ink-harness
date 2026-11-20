import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { projectService } from "@/services/projectService";
import { writingService } from "@/services/writingService";
import { useDraftSyncStore } from "@/stores/draftSync";
import { clearDraftBackup, readDraftBackup, writeDraftBackup } from "@/utils/draftBackup";
import { normalizeError } from "@/utils/errors";
import { onReactivated } from "@/utils/lifecycle";
import { countCharacters } from "@/utils/text";
import { useWritingChapters } from "./useWritingChapters";
import { useWritingVersions } from "./useWritingVersions";

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
  const error = ref("");

  // 章节列表与阶段归 useWritingChapters；正文与自动保存状态留在写作台主体。
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
  const saveState = ref<SaveState>("idle");
  const lastSavedAt = ref("");
  /** 供编辑器重新挂载用：切章或恢复版本时递增，让编辑器拿到新的初始内容。 */
  const editorRevision = ref(0);

  /**
   * 待落库的正文。带上 chapterId：切章时上一章的字还在队列里，
   * 若只记内容，切章后的循环会把新章的正文写进旧章（或反过来丢字）。
   */
  let pending: { chapterId: string; content: string; wordCount: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 在飞的那一轮保存。`flush()` 靠它串行：后到的调用者先等前一轮写完，
   * 再决定要不要写剩下的 pending，这样「离开页面前的保存」才是真屏障。
   */
  let inFlight: Promise<void> | null = null;
  /** 载入正文的请求序号：连点两章时，只有最后一次请求的结果允许落到编辑器。 */
  let loadSeq = 0;
  /**
   * 遇到版本冲突后暂停自动保存。
   * 冲突意味着库里的正文已经不是我们这一版，继续重试只会对同一个 conflict 空转，
   * 所以先把内容留在本地备份，等用户重新载入本章（loadContent 会复位）再继续。
   */
  let halted = false;
  /**
   * 每章「我读到的正文版本号」。
   * 按章节记在 Map 里而不是单个变量：切章时上一章可能还有一次补写，
   * 用当前章的版本去校验上一章会必然失败。
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

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

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
    if (inFlight) await inFlight;
    pending = null;
    clearTimer();
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
    halted = false;
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
      const data = await writingService.getContent(chapterId);
      // 连续点两章时先发的请求可能后返回：旧响应不能再覆盖当前章。
      if (seq !== loadSeq) return;
      loadedChapterId.value = chapterId;
      seenRevision = draftSync.revisionOf(chapterId);
      contentRevisions.set(chapterId, data.contentRevision);
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
        // 只有内容一致才清备份：不一致说明它是某次失败保存留下的稿子，
        // 而别的页面（审稿/工作流）推后 updated_at 也会走到这个分支，
        // 无条件清掉就等于把用户没落库的那段文字静默删除。
        if (backup && backup.content === data.content) clearDraftBackup(chapterId);
        content.value = data.content;
        wordCount.value = data.wordCount;
        saveState.value = "saved";
      }
      editorRevision.value += 1;
      await loadVersions(chapterId);
      // 载入期间用户在旧章里继续敲的字属于旧章：交给 flush 落库，别跟着换章一起丢掉。
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

  /** 编辑器输入：只更新字数与保存状态，落库交给防抖。 */
  function onEditorUpdate(payload: EditorPayload): void {
    const chapterId = loadedChapterId.value;
    if (!chapterId) return;
    pending = {
      chapterId,
      content: payload.content,
      wordCount: countCharacters(payload.text),
    };
    wordCount.value = pending.wordCount;
    clearTimer();
    if (halted) {
      // 冲突未解决前不再排保存：新敲的字同样写进本地备份，别让「继续写」变成「继续丢」。
      writeDraftBackup(chapterId, pending);
      saveState.value = "error";
      return;
    }
    saveState.value = "dirty";
    timer = setTimeout(() => void flush(), AUTOSAVE_DELAY);
  }

  /**
   * 立即把待保存内容写库。
   * 切章、离开页面、手动快照前都会调用它，保证「界面上看到的字」已经落盘。
   *
   * 串行：同一时刻只跑一轮保存；后到的调用先等在飞那轮结束，再处理自己看到的 pending。
   * 这样 `onBeforeRouteLeave` 里的 `await flush()` 才是真正的屏障，而不是「有请求在飞就返回」。
   */
  async function flush(): Promise<void> {
    clearTimer();
    if (inFlight) await inFlight;
    // 冲突后暂停：内容已备份，重试必然再次失败，交给用户重新载入后再写。
    if (halted) return;
    if (!pending) return;
    saveState.value = "saving";
    const run = (async () => {
      while (pending) {
        const payload = pending;
        pending = null;
        // 失败时内容已回到队列，这里必须停下：继续循环只会对同一个后端错误空转。
        if (!(await saveOnce(payload))) break;
      }
    })();
    inFlight = run;
    try {
      await run;
    } finally {
      if (inFlight === run) inFlight = null;
    }
  }

  /**
   * 关窗守卫（审计 D-34）：关窗瞬间只有 `void flush()`，进程可能在 IPC 返回前结束，
   * 正文既没落库也没备份。这里拦截关闭请求：有未保存内容就先等 flush 成为真屏障，
   * 完成后再销毁窗口；没有未保存内容直接放行。
   * flush 失败也不拦着关——saveOnce 的错误路径已把内容写进本地草稿备份。
   * 仅 Tauri 环境注册；浏览器 dev 下没有窗口 API。
   */
  let closeUnlisten: (() => void) | null = null;
  if ("__TAURI_INTERNALS__" in window) {
    void (async () => {
      const win = getCurrentWindow();
      closeUnlisten = await win.onCloseRequested(async (event) => {
        const unsaved =
          pending !== null || saveState.value === "dirty" || saveState.value === "saving";
        if (!unsaved) return;
        event.preventDefault();
        await flush();
        await win.destroy();
      });
    })();
  }
  onBeforeUnmount(() => closeUnlisten?.());

  /**
   * 写一次库，返回是否成功。
   * 失败时不抛异常（避免 `void flush()` 变成 unhandled rejection），
   * 而是把内容放回 pending 并标记 error，等下一次输入/切章/离开页面再试。
   */
  async function saveOnce(payload: {
    chapterId: string;
    content: string;
    wordCount: number;
  }): Promise<boolean> {
    const chapterId = payload.chapterId;
    try {
      const saved = await writingService.saveContent({
        chapterId,
        content: payload.content,
        wordCount: payload.wordCount,
        // 带上基准版本：库里已被别处改过时后端返回 conflict，避免静默覆盖。
        expectedContentRevision: contentRevisions.get(chapterId),
      });
      // 记下这次保存后的版本，后面的保存都以它为准。
      contentRevisions.set(chapterId, saved.contentRevision);
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
      const info = normalizeError(err);
      // 期间用户又输入了新内容时优先保留新的那份，别让旧 payload 把它盖掉。
      if (!pending) pending = payload;
      // 写库失败时把正文留在本地，否则关窗/崩溃就真的丢了；下次载入该章会提示恢复。
      writeDraftBackup(chapterId, payload);
      saveState.value = "error";
      if (info.code === "conflict") {
        halted = true;
        error.value = `${info.message}。当前文字已存入本地备份，请重新载入本章后再继续。`;
      } else {
        error.value = `保存失败：${info.message}（正文已留在本地备份）`;
      }
      return false;
    }
  }

  // 版本管理委托给独立 composable：注入自动保存桥接，避免两处各维护一份保存状态。
  const versionsApi = useWritingVersions({
    loadedChapterId,
    content,
    wordCount,
    saveState,
    lastSavedAt,
    editorRevision,
    contentRevisions,
    error,
    flush: () => flush(),
    getPending: () => pending,
    clearPending: () => {
      pending = null;
    },
    clearHalted: () => {
      halted = false;
    },
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
    if (inFlight) await inFlight;
    pending = null;
    clearTimer();
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
