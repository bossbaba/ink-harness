import { computed, ref } from "vue";
import { contextCharCount } from "@/services/aiContext";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { loadRelatedNotes } from "@/services/ragService";
import { getContextBudget } from "@/services/summaryService";
import { buildAssistMessages, toTaskKind } from "@/services/writingAiService";
import {
  ASSIST_TASK_LABEL,
  type AssistCardState,
  type AssistSelection,
  type AssistTask,
  type Project,
} from "@/types";

export interface WritingAssistOptions {
  projectId: string;
  /** 当前作品；可能尚未加载完，运行时再取一次。 */
  project: () => Project | null;
  chapterTitle: () => string;
  chapterSummary: () => string;
}

/**
 * 写作台 AI 辅助：把选中文本 + 作品上下文发给模型，流式收字，供页面决定插入还是替换。
 *
 * 这里不碰编辑器：位置（from/to）与回写动作都由页面拿着编辑器实例去执行，
 * 组合式函数只管「请求、流、错误、结果」四件事。
 */
export function useWritingAssist(options: WritingAssistOptions) {
  const show = ref(false);
  const task = ref<AssistTask>("continue");
  const target = ref<AssistSelection | null>(null);
  const output = ref("");
  const streaming = ref(false);
  const error = ref("");
  const contextChars = ref(0);
  /** 本次生成额外检索到的片段数，让作者知道「背景资料」从哪来。 */
  const retrievedCount = ref(0);

  // 作品上下文在会话内只拼一次；写作过程中设定/大纲变了才会重新打开页面。
  let contextCache: string | null = null;
  // 每次请求自增：关闭面板或重新生成后，旧请求迟到的分片会被直接丢弃。
  let requestSeq = 0;

  const taskLabel = computed(() => ASSIST_TASK_LABEL[task.value]);
  const canApply = computed(() => !streaming.value && output.value.trim().length > 0);
  // 续写没有选区，替换按钮必须置灰，否则会拿空选区去覆盖正文。
  const canReplace = computed(() => Boolean(target.value?.text.trim()));

  /** 面板卡片需要的全部字段：页面直接透传，不再自己拼 props。 */
  const card = computed<AssistCardState>(() => ({
    visible: show.value,
    taskLabel: taskLabel.value,
    output: output.value,
    streaming: streaming.value,
    error: error.value,
    contextChars: contextChars.value,
    retrievedCount: retrievedCount.value,
    canApply: canApply.value,
    canReplace: canReplace.value,
  }));

  async function loadContext(force = false): Promise<string> {
    if (!force && contextCache !== null) return contextCache;
    contextCache = await outlineService.buildContext(options.projectId);
    return contextCache;
  }

  /** 大纲/伏笔在别的页面改过后强制重取，避免 KeepAlive 下 AI 一直用旧上下文。 */
  async function refreshContext(): Promise<void> {
    await loadContext(true);
  }

  async function run(selection: AssistSelection): Promise<void> {
    target.value = selection;
    task.value = selection.task;
    show.value = true;
    output.value = "";
    error.value = "";
    retrievedCount.value = 0;
    streaming.value = true;
    const seq = ++requestSeq;

    try {
      const project = options.project();
      if (!project) throw new Error("作品还没加载完成，请稍后重试。");

      // 检索用选区正文做问题；续写没有选区时用前文最后一段，避免拿空串去搜。
      const query = selection.text.trim() || selection.before.slice(-300);
      const [context, notes, budget] = await Promise.all([
        loadContext(),
        loadRelatedNotes(options.projectId, query),
        getContextBudget(),
      ]);
      if (seq !== requestSeq) return;
      contextChars.value = contextCharCount(context, budget);
      retrievedCount.value = notes.hits.length;

      // Provider 可能在模型管理页才刚配置过，每次生成前刷新，避免用到旧缓存。
      await modelRouter.refresh();
      if (seq !== requestSeq) return;

      const messages = buildAssistMessages({
        project,
        chapterTitle: options.chapterTitle(),
        chapterSummary: options.chapterSummary(),
        context,
        selection,
        notes: notes.block,
        contextLimit: budget,
      });

      const handle = modelRouter.chat(
        { task: toTaskKind(selection.task), privacy: project.privacy, projectId: project.id },
        messages,
        (chunk) => {
          if (seq !== requestSeq) return;
          if (chunk.delta) output.value += chunk.delta;
        },
        (message) => {
          if (seq !== requestSeq) return;
          error.value = message;
        },
      );
      // 失败信息已经通过 onError 落到 error，这里只等流结束，不重复抛。
      await handle.done.catch(() => undefined);
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === requestSeq) streaming.value = false;
    }
  }

  /** 重新生成：沿用上一次的任务与选区。 */
  function retry(): void {
    if (target.value) void run(target.value);
  }

  /**
   * 停止生成：只作废进行中的请求，已收到的文字留在卡片里供作者取用。
   * 与 close() 的区别是卡片仍可见——毕竟没有「收起/丢弃」入口，停了还得能插入。
   */
  function stop(): void {
    requestSeq += 1;
    streaming.value = false;
  }

  /** 关闭面板：让进行中的请求作废，避免关掉后还往已卸载的界面里写内容。 */
  function close(): void {
    requestSeq += 1;
    show.value = false;
    streaming.value = false;
  }

  return {
    show,
    task,
    taskLabel,
    target,
    output,
    streaming,
    error,
    contextChars,
    retrievedCount,
    canApply,
    canReplace,
    card,
    run,
    refreshContext,
    retry,
    stop,
    close,
  };
}
