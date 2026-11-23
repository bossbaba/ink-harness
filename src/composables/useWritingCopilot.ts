import { computed, ref } from "vue";
import { useAgentActions } from "@/composables/useAgentActions";
import { useCopilotSession } from "@/composables/useCopilotSession";
import { runAgentLoop } from "@/services/agentLoop";
import { agentRoleService, parseRoleTools } from "@/services/agentRoleService";
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
import type {
  AgentMessageRecord,
  AgentRole,
  CopilotMessage,
  CopilotReference,
  CopilotSessionAction,
  CopilotSessionBarState,
  Project,
  StoryElement,
} from "@/types";

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

/** 把落库消息映射成界面消息；引用关系不持久化，恢复后不带 @ 标记。 */
function toMessages(records: AgentMessageRecord[]): CopilotMessage[] {
  return records.map((record) => ({
    id: record.id,
    role: record.role === "user" ? "user" : "assistant",
    content: record.content,
    references: [],
  }));
}

/**
 * 写作台 Copilot：多轮对话 + @引用设定/章节，流式收字。
 *
 * 与「AI 辅助」的区别：辅助是一次性的改写任务、结果直接回写正文；
 * Copilot 是聊天，结果只做展示，作者确认后才点「插入到正文」。
 * 因此这里不碰编辑器，插入动作由页面转交编辑器实例执行。
 *
 * 会话记忆、切换与落库在 useCopilotSession 里；角色（prompt + 工具白名单）
 * 在这里解析后传给 Agent Loop，让同一份模型配置能切换写作/审稿等身份。
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
  /** 会话记忆：列表、切换、重命名、删除与落库。 */
  const session = useCopilotSession(options.projectId);
  /** 角色列表与当前选择；空 roleId 表示「默认角色」（全部工具、无额外 prompt）。 */
  const roles = ref<AgentRole[]>([]);
  const roleId = ref("");
  const rolesError = ref("");
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

  // 作品上下文在会话内只拼一次：写作过程中设定/大纲变了，重新打开页面即可刷新。
  let contextCache: string | null = null;
  // 每次发送自增：停止或新问题到来后，旧请求迟到的分片直接丢弃。
  let requestSeq = 0;
  /** 当前进行中的请求 ID，停止时用 cancel_chat 通知后端真正断开上游连接。 */
  let activeRequestId = "";
  /** 记住已加载的作品，切作品后重取，同作品反复展开不重复请求。 */
  let referencesLoadedFor = "";

  /** 打开面板时恢复最近一次会话：关掉应用再回来还能接着聊。 */
  async function restore(): Promise<void> {
    const records = await session.restoreLatest();
    // 等待期间作者可能已经开聊，不能覆盖现场。
    if (records.length === 0 || messages.value.length > 0) return;
    messages.value = toMessages(records);
  }

  /** 加载角色列表；失败只提示，不影响默认角色的使用。 */
  async function loadRoles(): Promise<void> {
    try {
      roles.value = await agentRoleService.list();
    } catch (err) {
      rolesError.value = `读取角色失败：${String(err)}`;
    }
  }

  void restore();
  void loadRoles();

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
    const requestId = `copilot-${seq}`;
    activeRequestId = requestId;
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
        { task: "copilot", privacy: project.privacy, projectId: project.id, requestId },
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
      void session.persist(text, messages.value[answerIndex].content);
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err instanceof Error ? err.message : String(err);
      messages.value[answerIndex].failed = true;
    } finally {
      if (seq === requestSeq) streaming.value = false;
      if (seq === requestSeq) activeRequestId = "";
    }
  }

  /**
   * Agent 模式发送：跑「思考→行动→观察」循环，每轮结果追加到同一条助手消息里展示。
   * 与普通模式共用作品上下文/引用/检索口径，只是把一次性回答换成多轮循环。
   * 角色只裁剪工具与追加 prompt，不改变模型路由。
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
    const requestId = `copilot-${seq}`;
    activeRequestId = requestId;
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
      // 角色白名单为空表示全部工具；角色 prompt 作为附加要求拼在 system 末尾。
      const role = roles.value.find((item) => item.id === roleId.value) ?? null;
      const toolNames = parseRoleTools(role);

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
        toolNames,
        extraPrompt: role?.prompt ?? "",
        // Copilot 的价值是「读到真实作品再答」：首轮强制取数，避免模型拿着空白上下文编设定。
        requireToolFirst: supportsTools,
        requestId,
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
      // 会话记忆与轨迹落库：失败不影响对话展示；停止原因给看板算成功率。
      void session.persist(text, messages.value[answerIndex].content, result.steps, result.reason);
      agentProgress.value = "";
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err instanceof Error ? err.message : String(err);
      messages.value[answerIndex].failed = true;
    } finally {
      if (seq === requestSeq) streaming.value = false;
      if (seq === requestSeq) activeRequestId = "";
    }
  }

  /** 停止生成：作废进行中的请求，已收到的内容留在气泡里供作者取用。 */
  function stop(): void {
    requestSeq += 1;
    // 只增序号的话前端只是不再显示分片，上游仍在生成、仍在计费。
    if (activeRequestId) {
      void modelRouter.cancel(activeRequestId).catch(() => undefined);
      activeRequestId = "";
    }
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
    else if (action.type === "role") roleId.value = action.id;
    else agentMode.value = !agentMode.value;
  }

  /**
   * 会话条动作：新建/切换/重命名/删除会话。
   * 切换会话会整屏替换消息，正在流式生成时拒绝切换，避免半截回答丢进别的会话。
   */
  async function handleSessionAction(action: CopilotSessionAction): Promise<void> {
    if (streaming.value) {
      error.value = "正在生成回答，先停止再切换会话。";
      return;
    }
    if (action.type === "new") {
      // 已经停在一个空的「新对话」里就不重复建，否则连点几下会堆出一排空标签。
      const current = session.sessions.value.find((item) => item.id === session.currentId.value);
      if (current && current.title === "新对话" && messages.value.length === 0) return;
      messages.value = [];
      agentProgress.value = "";
      await session.createNew();
      return;
    }
    if (action.type === "switch") {
      const records = await session.open(action.id);
      messages.value = toMessages(records);
      return;
    }
    if (action.type === "rename") {
      await session.rename(action.id, action.title);
      return;
    }
    // 删除当前会话时清空界面，避免消息悬在一个已不存在的会话 id 上。
    const removingCurrent = action.id === session.currentId.value;
    await session.remove(action.id);
    if (removingCurrent) messages.value = [];
  }

  /** 清空对话：换作品或想重新开始时用，连同引用一起清掉，并开一条新会话。 */
  function clear(): void {
    // 复用 stop()：清空对话也要中断正在跑的流，否则后台继续生成没有地方展示。
    stop();
    messages.value = [];
    references.value = [];
    retrievedCount.value = 0;
    error.value = "";
    agentProgress.value = "";
    session.startNew();
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
      // 角色只影响 Agent 模式，所以跟着 Agent 面板走，不占会话条的空间。
      roles: roles.value,
      roleId: roleId.value,
      onAction: handleAgentAction,
    })),
    // 会话条同样打包：只放会话列表与当前会话，窄面板里不会挤成三行按钮。
    sessionBar: computed<CopilotSessionBarState>(() => ({
      sessions: session.sessions.value,
      currentId: session.currentId.value,
      loading: session.loading.value,
      error: rolesError.value || session.error.value,
      onAction: handleSessionAction,
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
