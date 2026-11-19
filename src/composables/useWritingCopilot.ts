import { ref } from "vue";
import { contextCharCount } from "@/services/aiContext";
import {
  buildCopilotMessages,
  buildCopilotSystem,
  buildReferenceBlock,
} from "@/services/copilotService";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { loadRelatedNotes } from "@/services/ragService";
import { storyElementService } from "@/services/storyElementService";
import { getContextBudget } from "@/services/summaryService";
import type { CopilotMessage, CopilotReference, Project, StoryElement } from "@/types";

export interface WritingCopilotOptions {
  projectId: string;
  /** 当前作品；可能尚未加载完，发送时再取一次。 */
  project: () => Project | null;
  chapterTitle: () => string;
  chapterSummary: () => string;
  /** 当前章节已有正文（含未保存改动），随每次提问重新读取。 */
  chapterText: () => string;
}

/** 消息 id 只用于列表 key，不需要全局唯一，递增即可。 */
let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `copilot-${messageSeq}`;
}

/**
 * 写作台 Copilot：多轮对话 + @引用设定/章节，流式收字。
 *
 * 与「AI 辅助」的区别：辅助是一次性的改写任务、结果直接回写正文；
 * Copilot 是聊天，结果只做展示，作者确认后才点「插入到正文」。
 * 因此这里不碰编辑器，插入动作由页面转交编辑器实例执行。
 */
export function useWritingCopilot(options: WritingCopilotOptions) {
  const messages = ref<CopilotMessage[]>([]);
  const streaming = ref(false);
  const error = ref("");
  const contextChars = ref(0);
  /** 下一条消息要携带的引用；发送后清空，避免每条都重复注入同一批资料。 */
  const references = ref<CopilotReference[]>([]);
  /** 最近一次提问检索到的片段数，用于在界面上说明「资料从哪来」。 */
  const retrievedCount = ref(0);
  // 以下四项是 @引用 选择器的候选数据：原本在 CopilotReferencePicker 内直接调 service，
  // 上移到 composable 后组件只收 props，保持「组件不直接请求」的分层。
  const referenceElements = ref<StoryElement[]>([]);
  const referenceChapters = ref<Array<{ id: string; act: number; title: string }>>([]);
  const referenceLoading = ref(false);
  const referenceError = ref("");
  /** 记住已加载的作品，切作品后重取，同作品反复展开不重复请求。 */
  let referencesLoadedFor = "";

  // 作品上下文在会话内只拼一次：写作过程中设定/大纲变了，重新打开页面即可刷新。
  let contextCache: string | null = null;
  // 每次发送自增：停止或新问题到来后，旧请求迟到的分片直接丢弃。
  let requestSeq = 0;

  /** 首次展开 @引用 面板时加载候选：设定全量 + 大纲快照，失败给出可见错误。 */
  async function loadReferences(): Promise<void> {
    if (!options.projectId || referencesLoadedFor === options.projectId) return;
    referenceLoading.value = true;
    referenceError.value = "";
    try {
      const [elements, snapshot] = await Promise.all([
        storyElementService.list(options.projectId),
        outlineService.snapshot(options.projectId),
      ]);
      referenceElements.value = elements;
      referenceChapters.value = snapshot.chapters.map((chapter) => ({
        id: chapter.id,
        act: chapter.act,
        title: chapter.title,
      }));
      referencesLoadedFor = options.projectId;
    } catch (err) {
      referenceError.value = err instanceof Error ? err.message : String(err);
    } finally {
      referenceLoading.value = false;
    }
  }

  async function loadContext(force = false): Promise<string> {
    if (!force && contextCache !== null) return contextCache;
    contextCache = await outlineService.buildContext(options.projectId);
    return contextCache;
  }

  /** 大纲/伏笔在别的页面改过后强制重取，避免 KeepAlive 下 AI 一直用旧上下文。 */
  async function refreshContext(): Promise<void> {
    await loadContext(true);
  }

  function addReference(reference: CopilotReference): void {
    // 同一条资料只引用一次，重复点选不再叠加。
    if (references.value.some((item) => item.kind === reference.kind && item.id === reference.id))
      return;
    references.value = [...references.value, reference];
  }

  function removeReference(reference: CopilotReference): void {
    references.value = references.value.filter(
      (item) => !(item.kind === reference.kind && item.id === reference.id),
    );
  }

  /** 发送一条提问。先占位一条空助手消息，流式分片往它身上累加，界面无需额外状态。 */
  async function send(question: string): Promise<void> {
    const text = question.trim();
    if (streaming.value) return;
    if (!text) {
      error.value = "先写一句想问的问题，或引用设定/章节后再发送。";
      return;
    }

    const attached = references.value;
    const history = messages.value;
    error.value = "";
    references.value = [];

    messages.value = [
      ...history,
      { id: nextMessageId(), role: "user", content: text, references: attached },
      { id: nextMessageId(), role: "assistant", content: "", references: [] },
    ];
    const answerIndex = messages.value.length - 1;
    const seq = ++requestSeq;
    streaming.value = true;

    try {
      const project = options.project();
      if (!project) throw new Error("作品还没加载完成，请稍后重试。");

      // 检索与引用并行：检索失败只返回空结果，不影响这次提问。
      const [context, referenceBlock, notes, budget] = await Promise.all([
        loadContext(),
        buildReferenceBlock(attached),
        loadRelatedNotes(options.projectId, text),
        getContextBudget(),
      ]);
      if (seq !== requestSeq) return;
      contextChars.value = contextCharCount(context, budget);
      retrievedCount.value = notes.hits.length;

      // Provider 可能刚在模型管理页改过，每次发送前刷新，避免用到旧缓存。
      await modelRouter.refresh();
      if (seq !== requestSeq) return;

      const chatMessages = buildCopilotMessages({
        system: buildCopilotSystem({
          project,
          chapterTitle: options.chapterTitle(),
          chapterSummary: options.chapterSummary(),
          chapterText: options.chapterText(),
          context,
          contextLimit: budget,
        }),
        history,
        question: text,
        referenceBlock,
        notes: notes.block,
      });

      const handle = modelRouter.chat(
        { task: "copilot", privacy: project.privacy, projectId: project.id },
        chatMessages,
        (chunk) => {
          if (seq !== requestSeq) return;
          // 必须通过数组下标写回，直接改闭包里的原始对象不会触发界面更新。
          messages.value[answerIndex].content += chunk.delta;
        },
        (message) => {
          if (seq !== requestSeq) return;
          error.value = message;
          messages.value[answerIndex].failed = true;
        },
      );
      await handle.done.catch(() => undefined);
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err instanceof Error ? err.message : String(err);
      messages.value[answerIndex].failed = true;
    } finally {
      if (seq === requestSeq) streaming.value = false;
    }
  }

  /** 停止生成：作废进行中的请求，已收到的内容留在气泡里供作者取用。 */
  function stop(): void {
    requestSeq += 1;
    streaming.value = false;
  }

  /** 清空对话：换作品或想重新开始时用，连同引用一起清掉。 */
  function clear(): void {
    requestSeq += 1;
    streaming.value = false;
    messages.value = [];
    references.value = [];
    retrievedCount.value = 0;
    error.value = "";
  }

  return {
    messages,
    streaming,
    error,
    contextChars,
    references,
    retrievedCount,
    referenceElements,
    referenceChapters,
    referenceLoading,
    referenceError,
    loadReferences,
    send,
    refreshContext,
    stop,
    clear,
    addReference,
    removeReference,
  };
}
