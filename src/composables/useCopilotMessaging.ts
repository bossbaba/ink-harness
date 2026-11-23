import { ref } from "vue";
import { type AgentStep, type AgentStopReason, runAgentLoop } from "@/services/agentLoop";
import { parseRoleTools } from "@/services/agentRoleService";
import { contextCharCount } from "@/services/aiContext";
import {
  buildCopilotMessages,
  buildCopilotSystem,
  buildReferenceBlock,
} from "@/services/copilotService";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { loadRelatedNotes } from "@/services/ragService";
import { getContextBudget } from "@/services/summaryService";
import type {
  AgentMessageRecord,
  AgentPlan,
  AgentRole,
  CopilotMessage,
  CopilotReference,
  Project,
} from "@/types";

/**
 * Copilot 消息流：负责「把一句提问变成回答」的全过程。
 *
 * 从 useWritingCopilot 拆出，原因有二：一是原文件已贴 500 行红线；二是消息发送
 * （上下文拼装、RAG 检索、流式收字、Agent 循环）是一块高内聚逻辑，与面板上的
 * 会话条/角色选择/引用选择器无关。本层只处理前者，界面状态仍由调用方持有。
 */

/** 发送层需要的外部依赖，全部以 getter 注入，避免反向依赖面板 composable。 */
export interface CopilotMessagingOptions {
  projectId: string;
  /** 当前作品可能还没加载完，发送时再取一次。 */
  project: () => Project | null;
  chapterTitle: () => string;
  chapterSummary: () => string;
  /** 当前章节正文（含未保存改动），每次发送重新读取。 */
  chapterText: () => string;
  chapterId?: () => string;
  /** 取出本次附带的引用并清空；发送后同一批引用不应带到下一条消息。 */
  takeReferences: () => CopilotReference[];
  /** 当前角色：只裁剪 Agent 工具与追加 prompt，不改变模型路由。 */
  role: () => AgentRole | null;
  /** 是否启用自主规划；默认关闭，由面板开关控制。 */
  planning: () => boolean;
  /** 消息与轨迹落库；失败不应阻塞对话展示。 */
  persist: (text: string, content: string, steps?: AgentStep[], reason?: AgentStopReason) => void;
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

export function useCopilotMessaging(options: CopilotMessagingOptions) {
  const messages = ref<CopilotMessage[]>([]);
  const streaming = ref(false);
  const error = ref("");
  const contextChars = ref(0);
  const retrievedCount = ref(0);
  /** Agent 循环的当前轮次与总轮次，供 UI 显示进度。 */
  const agentProgress = ref("");
  /** 当前任务计划，随每轮 update_plan / replan 更新；非规划模式恒为 null。 */
  const plan = ref<AgentPlan | null>(null);

  // 作品上下文在会话内只拼一次：写作过程中设定/大纲变了，重新打开页面即可刷新。
  let contextCache: string | null = null;
  // 每次发送自增：停止或新问题到来后，旧请求迟到的分片直接丢弃。
  let requestSeq = 0;
  /** 当前进行中的请求 ID，停止时用 cancel_chat 通知后端真正断开上游连接。 */
  let activeRequestId = "";

  /** 会话切换/恢复时整屏替换消息；不碰请求序号，切换前由调用方先 stop()。 */
  function setMessages(records: AgentMessageRecord[]): void {
    messages.value = toMessages(records);
  }

  /** 清空消息与进行态；换作品或新建会话时用，调用方需先 stop() 中断上游。 */
  function clearMessages(): void {
    messages.value = [];
    agentProgress.value = "";
    plan.value = null;
    contextChars.value = 0;
    retrievedCount.value = 0;
    error.value = "";
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

  /** 发送一条提问。Agent 模式走循环，普通模式走一次性流式回答。 */
  async function send(question: string, useAgent: boolean): Promise<void> {
    if (useAgent) {
      await sendAgent(question);
      return;
    }
    await sendPlain(question);
  }

  /** 一次性流式回答：结果只展示，作者再用「插入到正文」决定落稿。 */
  async function sendPlain(question: string): Promise<void> {
    const text = question.trim();
    if (streaming.value) return;
    if (!text) {
      error.value = "先写一句想问的问题，或引用设定/章节后再发送。";
      return;
    }

    const attached = options.takeReferences();
    const history = messages.value;
    error.value = "";

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
      void options.persist(text, messages.value[answerIndex].content);
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

    const attached = options.takeReferences();
    const history = messages.value;
    error.value = "";
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
      const role = options.role();
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
        // 规划是实验性开关；计划随每轮更新回传到面板展示。
        planning: options.planning(),
        onPlan: (next) => {
          plan.value = next;
        },
        shouldStop: () => seq !== requestSeq,
        onStep: (step) => appendStep(answerIndex, seq, step),
      });
      if (seq !== requestSeq) return;
      if (result.failure) {
        error.value = result.failure;
        messages.value[answerIndex].failed = true;
      } else if (!messages.value[answerIndex].content) {
        messages.value[answerIndex].content = result.answer || "（没有拿到结果）";
      }
      // 会话记忆与轨迹落库：失败不影响对话展示；停止原因给看板算成功率。
      void options.persist(text, messages.value[answerIndex].content, result.steps, result.reason);
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

  /** 把一轮循环进度追加到当前助手气泡，并更新进度行。 */
  function appendStep(answerIndex: number, seq: number, step: AgentStep): void {
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

  return {
    messages,
    streaming,
    error,
    contextChars,
    retrievedCount,
    agentProgress,
    plan,
    setMessages,
    clearMessages,
    loadContext,
    refreshContext,
    send,
    stop,
  };
}
