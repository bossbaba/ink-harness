import { onBeforeUnmount, onDeactivated, type Ref, ref } from "vue";
import { windowService } from "@/services/windowService";
import { writingService } from "@/services/writingService";
import type { ChapterContent, ChapterStatus } from "@/types";
import { clearDraftBackup, readDraftBackup, writeDraftBackup } from "@/utils/draftBackup";
import { type EditorPayload, type PendingDraft, serializeDraft } from "@/utils/draftPayload";
import { normalizeError } from "@/utils/errors";
import { countCharacters } from "@/utils/text";

/** 自动保存防抖间隔：太短会频繁写库，太长又容易在切章时丢刚写的内容。 */
const AUTOSAVE_DELAY = 1200;

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * 写作台的正文持久化状态机：防抖、串行保存、本地备份与关窗守卫。
 *
 * 从 useWritingDesk 拆出来是因为这几件事共用同一份私有状态（pending / inFlight /
 * halted / 定时器），拆开成两个 composable 就会出现两份真相；章节列表与版本管理
 * 仍留在写作台主体，通过下面的依赖对象注入，调用方接口不变。
 */
export interface WritingPersistenceDeps {
  projectId: string;
  /** 已载入正文的章节 id，切章时路由参数先变，不能拿它当保存目标。 */
  loadedChapterId: Ref<string>;
  content: Ref<string>;
  wordCount: Ref<number>;
  error: Ref<string>;
  /** 每章读到/保存后的正文版本号，按章记录避免切章串用基准。 */
  contentRevisions: Map<string, number>;
  patchChapter: (chapterId: string, patch: { wordCount?: number; status?: ChapterStatus }) => void;
  markDraftingStage: () => void | Promise<void>;
}

export function useWritingPersistence(deps: WritingPersistenceDeps) {
  const saveState = ref<SaveState>("idle");
  const lastSavedAt = ref("");

  /**
   * 待落库的正文。带上 chapterId：切章时上一章的字还在队列里，
   * 若只记内容，切章后的循环会把新章的正文写进旧章（或反过来丢字）。
   */
  let pending: PendingDraft | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 在飞的那一轮保存。`flush()` 靠它串行：后到的调用者先等前一轮写完，
   * 再决定要不要写剩下的 pending，这样「离开页面前的保存」才是真屏障。
   */
  let inFlight: Promise<void> | null = null;
  /**
   * 遇到版本冲突后暂停自动保存。
   * 冲突意味着库里的正文已经不是我们这一版，继续重试只会对同一个 conflict 空转，
   * 所以先把内容留在本地备份，等用户重新载入本章（会复位 halted）再继续。
   */
  let halted = false;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** 丢弃过期稿子（切章、外部改正文、章节被删时调用）。 */
  function discardPending(): void {
    pending = null;
    clearTimer();
  }

  /** 等在飞保存结束，供「丢弃 pending 前」使用。 */
  async function waitForFlush(): Promise<void> {
    if (inFlight) await inFlight;
  }

  function getPending(): PendingDraft | null {
    return pending;
  }

  function setPending(next: PendingDraft | null): void {
    pending = next;
  }

  function resetHalted(): void {
    halted = false;
  }

  /**
   * 载入正文时处理本地备份：备份比库里新就载入编辑器并提示保存；
   * 内容一致则清备份。返回是否用了备份，让调用方决定还要不要覆盖编辑器内容。
   */
  function applyServerContent(chapterId: string, data: ChapterContent): void {
    const backup = readDraftBackup(chapterId);
    const serverTime = Date.parse(data.updatedAt);
    const backupIsNewer =
      backup !== null && (!Number.isFinite(serverTime) || backup.savedAt > serverTime);
    if (backup && backupIsNewer) {
      deps.content.value = backup.content;
      deps.wordCount.value = backup.wordCount;
      saveState.value = "error";
      deps.error.value = "检测到上次未保存的本地备份，已载入编辑器，请确认后保存。";
      return;
    }
    // 只有内容一致才清备份：不一致说明它是某次失败保存留下的稿子，
    // 别的页面推后 updated_at 也会走到这里，无条件清掉等于静默删除用户文字。
    if (backup && backup.content === data.content) clearDraftBackup(chapterId);
    deps.content.value = data.content;
    deps.wordCount.value = data.wordCount;
    saveState.value = "saved";
  }

  /** 编辑器输入：只更新字数与保存状态，落库交给防抖。 */
  function onEditorUpdate(payload: EditorPayload): void {
    const chapterId = deps.loadedChapterId.value;
    if (!chapterId) return;
    pending = {
      chapterId,
      doc: payload.doc,
      wordCount: countCharacters(payload.text),
    };
    deps.wordCount.value = pending.wordCount;
    clearTimer();
    if (halted) {
      // 冲突未解决前不再排保存：新敲的字同样写进本地备份，别让「继续写」变成「继续丢」。
      writeDraftBackup(chapterId, {
        content: serializeDraft(pending),
        wordCount: pending.wordCount,
      });
      saveState.value = "error";
      return;
    }
    saveState.value = "dirty";
    timer = setTimeout(() => void flush(), AUTOSAVE_DELAY);
  }

  /**
   * 立即把待保存内容写库。切章、离开页面、手动快照前都会调用它。
   * 同一时刻只跑一轮；后到的调用先等在飞那轮结束，再处理自己看到的 pending，
   * 这样 `await flush()` 才是真屏障，而不是「有请求在飞就返回」。
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

  /** 写一次库，返回是否成功。失败不抛异常，避免 `void flush()` 变成 unhandled rejection。 */
  async function saveOnce(payload: PendingDraft): Promise<boolean> {
    const chapterId = payload.chapterId;
    const content = serializeDraft(payload);
    // 发 IPC 之前先写本地备份：进程若在请求返回前被强杀，正文至少还在本地。
    // 只在失败后才写不够——正在飞的那一次恰好是关窗场景最容易丢的那份。
    writeDraftBackup(chapterId, { content, wordCount: payload.wordCount });
    try {
      const saved = await writingService.saveContent(
        {
          chapterId,
          content,
          wordCount: payload.wordCount,
          expectedContentRevision: deps.contentRevisions.get(chapterId),
        },
        deps.projectId,
      );
      deps.contentRevisions.set(chapterId, saved.contentRevision);
      deps.patchChapter(chapterId, {
        wordCount: saved.wordCount,
        status: saved.wordCount > 0 ? "drafting" : undefined,
      });
      // 等待 IPC 期间若又有新输入，先给它补备份再覆盖旧备份，避免保存成功反留无备份窗口。
      if (pending && pending.chapterId === chapterId) {
        writeDraftBackup(chapterId, {
          content: serializeDraft(pending),
          wordCount: pending.wordCount,
        });
      } else {
        clearDraftBackup(chapterId);
      }
      // 请求返回时用户可能已切到别的章节，此时旧结果不应覆盖当前页的状态栏。
      if (deps.loadedChapterId.value !== chapterId) return true;
      deps.wordCount.value = saved.wordCount;
      lastSavedAt.value = saved.updatedAt;
      saveState.value = "saved";
      if (saved.wordCount > 0) void deps.markDraftingStage();
      return true;
    } catch (err) {
      const info = normalizeError(err);
      // 期间用户又输入了新内容时优先保留新的那份，别让旧 payload 把它盖掉。
      if (!pending) pending = payload;
      // 写库失败时把正文留在本地，否则关窗/崩溃就真的丢了。
      const failureBackup = writeDraftBackup(chapterId, {
        content,
        wordCount: payload.wordCount,
      });
      const backupHint = failureBackup
        ? "正文已留在本地备份"
        : "本地备份也写入失败，请先手动复制正文再关闭窗口";
      saveState.value = "error";
      if (info.code === "conflict") {
        halted = true;
        deps.error.value = `${info.message}。${backupHint}，请重新载入本章后再继续。`;
      } else {
        deps.error.value = `保存失败：${info.message}（${backupHint}）`;
      }
      return false;
    }
  }

  /**
   * 注册关窗与切后台守卫。原生窗口 API 只在 api 层使用，这里通过
   * `guardWindowClose` 间接调用，浏览器/单测环境下它会退化为空操作。
   */
  function installGuards(): void {
    // onBeforeUnmount 必须在 setup 的同步阶段注册：放进 .then 会脱离当前实例，
    // 既不会真正挂到组件上，keep-alive 反复激活时监听器也会叠加。
    let unlistenClose: (() => void) | null = null;
    let unmounted = false;
    void windowService
      .guardWindowClose(
        () => pending !== null || saveState.value === "dirty" || saveState.value === "saving",
        flush,
      )
      .then((unlisten) => {
        // 注册是异步的，若期间已卸载，立刻解除，避免留下悬空监听。
        if (unmounted) unlisten();
        else unlistenClose = unlisten;
      });
    onBeforeUnmount(() => {
      unmounted = true;
      unlistenClose?.();
      unlistenClose = null;
    });

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onBeforeUnmount(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void flush();
    });
    // 页面被 keep-alive 缓存后，离开走 deactivated 而不是 unmount。
    onDeactivated(() => void flush());
  }

  return {
    saveState,
    lastSavedAt,
    clearTimer,
    discardPending,
    waitForFlush,
    getPending,
    setPending,
    resetHalted,
    applyServerContent,
    onEditorUpdate,
    flush,
    installGuards,
  };
}
