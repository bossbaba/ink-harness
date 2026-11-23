import { computed, ref } from "vue";
import { useAgentActions } from "@/composables/useAgentActions";
import { useCopilotMessaging } from "@/composables/useCopilotMessaging";
import { useCopilotSession } from "@/composables/useCopilotSession";
import { agentRoleService } from "@/services/agentRoleService";
import { outlineService } from "@/services/outlineService";
import { storyElementService } from "@/services/storyElementService";
import type {
  AgentPanelAction,
  AgentRole,
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

/**
 * 写作台 Copilot 的组装层：只管面板上的控件状态与会话生命周期。
 *
 * 消息流（上下文拼装、流式收字、Agent 循环）已下沉到 useCopilotMessaging；
 * 会话记忆/切换/落库在 useCopilotSession；这里负责把三者拼成一个面板，
 * 并把「审批 / 角色 / 引用 / 会话」这几个动作收敛成两个事件出口给页面。
 */
export function useWritingCopilot(options: WritingCopilotOptions) {
  /** Agent 模式开关：默认关闭，开启后提问会走「思考→行动→观察」循环。 */
  const agentMode = ref(false);
  /** 自主规划开关：默认关闭；开启后 Agent 会先拆任务，再按计划逐步执行。 */
  const planning = ref(false);
  /** 会话记忆：列表、切换、重命名、删除与落库。要先建，审批队列才能按会话隔离。 */
  const session = useCopilotSession(options.projectId);
  /** 写操作审批队列：read 自动执行、write 挂起等作者确认；切会话只看到自己的队列。 */
  const agentActions = useAgentActions(() => ({
    projectId: options.projectId,
    chapterId: options.chapterId?.() || undefined,
    sessionId: session.currentId.value,
  }));
  /** 角色列表与当前选择；空 roleId 表示「默认角色」（全部工具、无额外 prompt）。 */
  const roles = ref<AgentRole[]>([]);
  const roleId = ref("");
  const rolesError = ref("");
  /** 下一条消息要携带的引用；发送后清空，避免每条都重复注入同一批资料。 */
  const references = ref<CopilotReference[]>([]);
  // 以下四项是 @引用 选择器的候选数据：原本在 CopilotReferencePicker 内直接调 service，
  // 上移到 composable 后组件只收 props，保持「组件不直接请求」的分层。
  const referenceElements = ref<StoryElement[]>([]);
  const referenceChapters = ref<Array<{ id: string; act: number; title: string }>>([]);
  const referenceLoading = ref(false);
  const referenceError = ref("");

  /** 记住已加载的作品，切作品后重取，同作品反复展开不重复请求。 */
  let referencesLoadedFor = "";

  const messaging = useCopilotMessaging({
    projectId: options.projectId,
    project: options.project,
    chapterTitle: options.chapterTitle,
    chapterSummary: options.chapterSummary,
    chapterText: options.chapterText,
    chapterId: options.chapterId,
    // 发送时取走引用并清空，保证同一批资料不会重复出现在后续消息里。
    takeReferences: () => {
      const attached = references.value;
      references.value = [];
      return attached;
    },
    role: () => roles.value.find((item) => item.id === roleId.value) ?? null,
    planning: () => planning.value,
    persist: (text, content, steps, reason) => session.persist(text, content, steps, reason),
  });

  /** 打开面板时恢复最近一次会话：关掉应用再回来还能接着聊。 */
  async function restore(): Promise<void> {
    const records = await session.restoreLatest();
    // 等待期间作者可能已经开聊，不能覆盖现场。
    if (records.length === 0 || messaging.messages.value.length > 0) return;
    messaging.setMessages(records);
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

  /** 发送一条提问：Agent 开关决定走多轮循环还是一次性回答。 */
  async function send(question: string): Promise<void> {
    await messaging.send(question, agentMode.value);
  }

  /**
   * 处理 Agent 面板的统一动作。插入正文需要编辑器实例，由调用方通过 insert 回调注入，
   * 这样 composable 不依赖具体编辑器，也避免在页面里堆五个事件处理函数。
   */
  async function handleAgentAction(action: AgentPanelAction): Promise<void> {
    // 审批结果写回对话：模型下一轮才知道工具真的执行了还是被驳回，
    // 不再出现「我只提交了审批、不知道作者做了什么」的失忆式回答。
    if (action.type === "approve") {
      const decided = await agentActions.approve(action.id);
      if (decided) messaging.appendToolDecision(decided);
    } else if (action.type === "reject") {
      const decided = agentActions.reject(action.id);
      if (decided) messaging.appendToolDecision(decided);
    } else if (action.type === "insert") options.insertAtCursor?.(action.text);
    else if (action.type === "clear") agentActions.clear();
    else if (action.type === "role") roleId.value = action.id;
    else if (action.type === "toggle-planning") planning.value = !planning.value;
    else agentMode.value = !agentMode.value;
  }

  /**
   * 会话条动作：新建/切换/重命名/删除会话。
   * 切换会话会整屏替换消息，正在流式生成时拒绝切换，避免半截回答丢进别的会话。
   */
  async function handleSessionAction(action: CopilotSessionAction): Promise<void> {
    if (messaging.streaming.value) {
      messaging.error.value = "正在生成回答，先停止再切换会话。";
      return;
    }
    if (action.type === "new") {
      // 已经停在一个空的「新对话」里就不重复建，否则连点几下会堆出一排空标签。
      const current = session.sessions.value.find((item) => item.id === session.currentId.value);
      if (current && current.title === "新对话" && messaging.messages.value.length === 0) return;
      messaging.clearMessages();
      await session.createNew();
      return;
    }
    if (action.type === "switch") {
      messaging.setMessages(await session.open(action.id));
      return;
    }
    if (action.type === "rename") {
      await session.rename(action.id, action.title);
      return;
    }
    // 删除当前会话时清空界面，避免消息悬在一个已不存在的会话 id 上。
    const removingCurrent = action.id === session.currentId.value;
    await session.remove(action.id);
    if (removingCurrent) messaging.clearMessages();
  }

  /** 清空对话：换作品或想重新开始时用，连同引用一起清掉，并开一条新会话。 */
  function clear(): void {
    // 复用 stop()：清空对话也要中断正在跑的流，否则后台继续生成没有地方展示。
    messaging.stop();
    messaging.clearMessages();
    references.value = [];
    session.startNew();
  }

  return {
    messages: messaging.messages,
    streaming: messaging.streaming,
    error: messaging.error,
    contextChars: messaging.contextChars,
    // Agent 面板的状态打包成一个 prop，页面只转发一个 action 事件即可。
    agentPanel: computed(() => ({
      actions: agentActions.pending.value,
      busyId: agentActions.busyId.value,
      error: agentActions.error.value,
      mode: agentMode.value,
      progress: messaging.agentProgress.value,
      plan: messaging.plan.value,
      planning: planning.value,
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
    retrievedCount: messaging.retrievedCount,
    referenceElements,
    referenceChapters,
    referenceLoading,
    referenceError,
    loadReferences,
    send,
    refreshContext: messaging.refreshContext,
    stop: messaging.stop,
    clear,
    addReference,
    removeReference,
  };
}
