import { computed, ref } from "vue";
import { useAgentActions } from "@/composables/useAgentActions";
import { runAgentLoop } from "@/services/agentLoop";
import { agentSessionService } from "@/services/agentSessionService";
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
  /** 当前章节 id，Agent 工具读写正文时用；可选。 */
  chapterId?: () => string;
  /** Agent 通过审批后把候选文本插入正文的回调；由写作台注入编辑器实例。 */
  insertAtCursor?: (text: string) => void;
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
  /** Agent 模式开关：默认关闭，开启后提问会走「思考→行动→观察」循环。 */
  const agentMode = ref(false);
  /** Agent 循环的当前轮次与总轮次，供 UI 显示进度。 */
  const agentProgress = ref("");
  /** 写操作审批队列：read 自动执行、write 挂起等作者确认。 */
  const agentActions = useAgentActions(() => ({
    projectId: options.projectId,
    chapterId: options.chapterId?.() || undefined,
  }));
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
  /** 当前会话 id；首次发送时惰性创建，失败不阻塞对话（持久化是锦上添花）。 */
  let sessionId = "";

  /** 确保会话存在，返回会话 id；并发调用复用同一个 promise，避免建出多个会话。 */
  let sessionPromise: Promise<string> | null = null;
  function ensureSession(): Promise<string> {
    if (sessionId) return Promise.resolve(sessionId);
    if (!sessionPromise) {
      sessionPromise = agentSessionService
        .create({ projectId: options.projectId })
        .then((session) => {
          sessionId = session.id;
          return session.id;
        })
        .finally(() => {
          sessionPromise = null;
        });
    }
    return sessionPromise;
  }

  /**
   * 打开面板时恢复最近一次会话的历史消息：作者关掉应用再回来还能接着聊。
   * 恢复失败只记日志不打断——记忆是锦上添花，对话本身不依赖它。
   */
  async function restoreSession(): Promise<void> {
    try {
      const sessions = await agentSessionService.list(options.projectId);
      const latest = sessions[0];
      if (!latest) return;
      const records = await agentSessionService.listMessages(latest.id);
      // 等待期间作者可能已经开聊：ensureSession 建了新会话、消息也进了列表，不能覆盖现场。
      if (sessionId || messages.value.length > 0) return;
      sessionId = latest.id;
      if (records.length === 0) return;
      messages.value = records.map((record) => ({
        id: record.id,
        role: record.role === "user" ? "user" : "assistant",
        content: record.content,
        references: [],
      }));
    } catch (err) {
      console.warn("恢复 Copilot 会话失败：", err);
    }
  }
  void restoreSession();

  /** 生成一条落库消息 id，避免同一毫秒内两条消息撞 id。 */
  let persistSeq = 0;
  function nextPersistId(): string {
    persistSeq += 1;
    return `persist-${Date.now()}-${persistSeq}`;
  }

  /** 一轮持久化步骤的类型（轨迹落库用）；tokens/latencyMs 来自 Loop 的真实记账。 */
  interface StepToPersist {
    iteration: number;
    calls: Array<{ name: string; arguments: Record<string, unknown> }>;
    observations: Array<{ toolName: string; content: string; isError: boolean }>;
    tokens: number;
    latencyMs: number;
  }

  /**
   * 把一次问答（用户消息 + 助手回答 + Agent 轨迹）顺序落库。
   * 全部异常都吞掉并记日志：记忆写入是锦上添花，失败不该打断正在进行的对话。
   */
  async function persistExchange(
    question: string,
    answer: string,
    steps: StepToPersist[] = [],
  ): Promise<void> {
    try {
      const sid = await ensureSession();
      await agentSessionService.appendMessage({
        id: nextPersistId(),
        sessionId: sid,
        role: "user",
        content: question,
      });
      await agentSessionService.appendMessage({
        id: nextPersistId(),
        sessionId: sid,
        role: "assistant",
        content: answer,
      });
      for (const step of steps) {
        await agentSessionService.appendStep({
          sessionId: sid,
          iteration: step.iteration,
          toolCalls: JSON.stringify(step.calls),
          observations: JSON.stringify(step.observations),
          tokens: step.tokens,
          latencyMs: step.latencyMs,
        });
      }
    } catch (err) {
      console.warn("保存 Copilot 会话失败：", err);
    }
  }

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

  /** 发送一条提问。Agent 模式走循环，普通模式走一次性流式回答。 */
  async function send(question: string): Promise<void> {
    if (agentMode.value) {
      await sendAgent(question);
      return;
    }
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
      // 对话落库：失败不阻塞，作者仍能正常看到与使用回答。
      void persistExchange(text, messages.value[answerIndex].content);
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err instanceof Error ? err.message : String(err);
      messages.value[answerIndex].failed = true;
    } finally {
      if (seq === requestSeq) streaming.value = false;
    }
  }

  /**
   * Agent 模式发送：跑「思考→行动→观察」循环，每轮结果追加到同一条助手消息里展示。
   * 与普通模式共用作品上下文/引用/检索口径，只是把一次性回答换成多轮循环。
   */
  async function sendAgent(question: string): Promise<void> {
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
    agentProgress.value = "";

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

      const [context, referenceBlock, notes, budget] = await Promise.all([
        loadContext(),
        buildReferenceBlock(attached),
        loadRelatedNotes(options.projectId, text),
        getContextBudget(),
      ]);
      if (seq !== requestSeq) return;
      contextChars.value = contextCharCount(context, budget);
      retrievedCount.value = notes.hits.length;

      await modelRouter.refresh();
      if (seq !== requestSeq) return;
      const selected = modelRouter.select({ task: "copilot", privacy: project.privacy });
      const supportsTools = selected?.capabilities.tools === true;

      const system = buildCopilotSystem({
        project,
        chapterTitle: options.chapterTitle(),
        chapterSummary: options.chapterSummary(),
        chapterText: options.chapterText(),
        context,
        contextLimit: budget,
      });
      const chatMessages = buildCopilotMessages({
        system,
        history,
        question: text,
        referenceBlock,
        notes: notes.block,
      });

      const result = await runAgentLoop({
        task: "copilot",
        privacy: project.privacy,
        projectId: project.id,
        ctx: { projectId: project.id, chapterId: options.chapterId?.() || undefined },
        system,
        // 复用已组装的消息作为历史，问题由循环自己加，这里去掉末尾的 user 问题避免重复。
        history: chatMessages.filter((message) => message.role !== "system").slice(0, -1),
        question: chatMessages[chatMessages.length - 1]?.content ?? text,
        supportsTools,
        shouldStop: () => seq !== requestSeq,
        onStep: (step) => {
          if (seq !== requestSeq) return;
          agentProgress.value = `第 ${step.iteration} 轮 · ${step.calls.length} 次工具调用`;
          const block = [
            `【第 ${step.iteration} 轮】`,
            step.text ||
              (step.calls.length ? `调用工具：${step.calls.map((c) => c.name).join("、")}` : ""),
            ...step.observations.map((o) => `→ ${o.toolName}：${o.content}`),
          ]
            .filter(Boolean)
            .join("\n");
          messages.value[answerIndex].content +=
            `${messages.value[answerIndex].content ? "\n\n" : ""}${block}`;
        },
      });
      if (seq !== requestSeq) return;
      if (result.failure) {
        error.value = result.failure;
        messages.value[answerIndex].failed = true;
      } else if (!messages.value[answerIndex].content) {
        messages.value[answerIndex].content = result.answer || "（没有拿到结果）";
      }
      // 会话记忆与轨迹落库：失败不影响对话展示。
      void persistExchange(text, messages.value[answerIndex].content, result.steps);
      agentProgress.value = "";
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
    agentProgress.value = "";
  }

  /**
   * 处理 Agent 面板的统一动作。插入正文需要编辑器实例，由调用方通过 insert 回调注入，
   * 这样 composable 不依赖具体编辑器，也避免在页面里堆五个事件处理函数。
   */
  async function handleAgentAction(action: import("@/types").AgentPanelAction): Promise<void> {
    if (action.type === "approve") await agentActions.approve(action.id);
    else if (action.type === "reject") agentActions.reject(action.id);
    else if (action.type === "insert") options.insertAtCursor?.(action.text);
    else if (action.type === "clear") agentActions.clear();
    else agentMode.value = !agentMode.value;
  }

  /** 清空对话：换作品或想重新开始时用，连同引用一起清掉。 */
  function clear(): void {
    requestSeq += 1;
    streaming.value = false;
    messages.value = [];
    references.value = [];
    retrievedCount.value = 0;
    error.value = "";
    agentProgress.value = "";
    // 清空即视为开新会话：下次发送时 ensureSession 另建一条，历史不再混在一起。
    sessionId = "";
  }

  return {
    messages,
    streaming,
    error,
    contextChars,
    // Agent 面板的状态打包成一个 prop，页面只转发一个 action 事件即可。
    agentPanel: computed(() => ({
      actions: agentActions.pending.value,
      busyId: agentActions.busyId.value,
      error: agentActions.error.value,
      mode: agentMode.value,
      progress: agentProgress.value,
      onAction: handleAgentAction,
    })),
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
