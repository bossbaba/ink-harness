import { ref } from "vue";
import type { AgentStep } from "@/services/agentLoop";
import { agentSessionService } from "@/services/agentSessionService";
import { scrubArgs } from "@/services/guardrails";
import type { AgentSession } from "@/types";

/**
 * Copilot 会话记忆：会话列表、切换、重命名、删除与消息落库。
 *
 * 从 useWritingCopilot 拆出来，一是控制单文件行数，二是让「会话管理」与
 * 「对话流程」各自独立：前者只碰库，后者负责取数、跑 Agent Loop。
 *
 * 所有写库失败都只记日志、不打断对话——记忆是锦上添花，
 * 作者正在看的回答不该因为一次落库失败而被清掉。
 */
export function useCopilotSession(projectId: string) {
  const sessions = ref<AgentSession[]>([]);
  const currentId = ref("");
  const loading = ref(false);
  const error = ref("");

  /** 与 currentId 同步的内部值；存在性判断走它，避免 ref 解包带来的异步歧义。 */
  let sessionId = "";
  /** 并发调用复用同一个创建请求，避免一次问答建出两个会话。 */
  let creating: Promise<string> | null = null;

  function setCurrent(id: string): void {
    sessionId = id;
    currentId.value = id;
  }

  /** 确保会话存在；首次发送时惰性创建，标题取首句问题，便于在列表里辨认。 */
  function ensureSession(title = "新对话"): Promise<string> {
    if (sessionId) return Promise.resolve(sessionId);
    if (!creating) {
      creating = agentSessionService
        .create({ projectId, title: title.slice(0, 24) })
        .then((session) => {
          setCurrent(session.id);
          sessions.value = [session, ...sessions.value];
          return session.id;
        })
        .finally(() => {
          creating = null;
        });
    }
    return creating;
  }

  /** 拉取当前作品的会话列表（按更新时间倒序，接口已排好）。 */
  async function loadSessions(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      sessions.value = await agentSessionService.list(projectId);
    } catch (err) {
      error.value = `读取会话列表失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 打开指定会话并返回它的历史消息；失败时返回空数组，界面保持现状。 */
  async function open(id: string) {
    try {
      const records = await agentSessionService.listMessages(id);
      setCurrent(id);
      return records;
    } catch (err) {
      error.value = `读取会话失败：${String(err)}`;
      return [];
    }
  }

  /**
   * 恢复最近一次会话；没有会话时返回空数组。
   * 消息内容、引用与工具名摘要一并恢复；完整轨迹仍在看板，聊天区只做轻量提示。
   */
  async function restoreLatest() {
    try {
      const list = await agentSessionService.list(projectId);
      sessions.value = list;
      const latest = list[0];
      if (!latest) return [];
      const records = await agentSessionService.listMessages(latest.id);
      setCurrent(latest.id);
      return records;
    } catch (err) {
      error.value = `恢复会话失败：${String(err)}`;
      return [];
    }
  }

  /** 开新会话：清掉当前 id，下次发送时 ensureSession 另建一条。 */
  function startNew(): void {
    setCurrent("");
  }

  /**
   * 立即新建一条会话并切过去。
   *
   * Tab 风格下「点 + 就该出现一个新标签」：如果仍走惰性创建，点完界面毫无变化，
   * 作者会以为按钮没生效。空会话可以随时关闭，代价远小于「点了没反应」的困惑。
   */
  async function createNew(title = "新对话"): Promise<void> {
    // 上一次创建还没回来时先等它，避免两条并发请求各建一个会话。
    if (creating) await creating.catch(() => undefined);
    setCurrent("");
    try {
      await ensureSession(title);
    } catch (err) {
      error.value = `新建会话失败：${String(err)}`;
    }
  }

  /** 重命名：本地列表同步改名，失败回滚并给出可见错误。 */
  async function rename(id: string, title: string): Promise<void> {
    const previous = sessions.value;
    sessions.value = sessions.value.map((item) =>
      item.id === id ? { ...item, title: title.trim() || "未命名对话" } : item,
    );
    try {
      await agentSessionService.rename(id, title);
    } catch (err) {
      sessions.value = previous;
      error.value = `重命名失败：${String(err)}`;
    }
  }

  /** 删除：连带消息与轨迹（后端负责），删除当前会话时把界面切回「未开始」状态。 */
  async function remove(id: string): Promise<void> {
    try {
      await agentSessionService.remove(id);
      sessions.value = sessions.value.filter((item) => item.id !== id);
      if (sessionId === id) setCurrent("");
    } catch (err) {
      error.value = `删除会话失败：${String(err)}`;
    }
  }

  /**
   * 把一次问答落库：用户消息（含引用）、助手消息（含工具调用与停止原因）、每轮轨迹。
   * 顺序写入而不是并行：轨迹行依赖会话存在，且顺序错乱会让看板回放读起来颠倒。
   *
   * 失败不再只 console.warn——作者需要知道「这次回答没存上」，
   * 否则关掉应用后才发现对话丢了，完全无从补救。
   */
  async function persist(input: {
    question: string;
    answer: string;
    references?: Array<{ kind: string; id: string; label: string }>;
    steps?: AgentStep[];
    reason?: string;
  }): Promise<void> {
    const { question, answer, references = [], steps = [], reason } = input;
    error.value = "";
    try {
      const sid = await ensureSession(question);
      // 点「+」建的是空会话，标题形如「新对话」「新对话 2」；发第一条消息后用首句命名，
      // 标签栏里才分得清谁是谁。已经命名的会话不再改动，尊重作者手动改过的标题。
      const named = sessions.value.find((item) => item.id === sid);
      if (named?.title.startsWith("新对话")) {
        await rename(sid, question.replace(/\s+/g, " ").slice(0, 24));
      }
      // 消息 id 由前端生成：同一毫秒内两条消息会撞主键，加序号区分。
      let seq = 0;
      const nextId = (): string => {
        seq += 1;
        return `msg-${Date.now()}-${seq}`;
      };
      await agentSessionService.appendMessage({
        id: nextId(),
        sessionId: sid,
        role: "user",
        content: question,
        // 引用随提问一起存，恢复会话时才能重建 @ 标记。
        references: references.length ? JSON.stringify(references) : "",
      });
      await agentSessionService.appendMessage({
        id: nextId(),
        sessionId: sid,
        role: "assistant",
        content: answer,
        // 工具调用随助手消息一起存，恢复会话时能看出这轮动过哪些工具。
        toolCalls: steps.length
          ? JSON.stringify(
              steps.flatMap((step) =>
                step.calls.map((call) => ({
                  name: call.name,
                  // 会话会长期留在 SQLite，工具参数必须先脱敏，不能依赖上游一定洗过。
                  arguments: scrubArgs(call.arguments),
                })),
              ),
            )
          : "",
        stopReason: reason,
      });
      for (const step of steps) {
        await agentSessionService.appendStep({
          sessionId: sid,
          iteration: step.iteration,
          // 轨迹里的参数与观察结果同样会落库，逐项脱敏后再序列化。
          toolCalls: JSON.stringify(
            step.calls.map((call) => ({ ...call, arguments: scrubArgs(call.arguments) })),
          ),
          observations: JSON.stringify(step.observations),
          tokens: step.tokens,
          latencyMs: step.latencyMs,
          model: step.model,
        });
      }
    } catch (err) {
      error.value = `本次对话没能保存：${String(err)}`;
    }
  }

  /**
   * 把一条后补的助手消息（如工具审批回执）写进当前会话。
   * 没有会话时静默跳过——审批总发生在一次问答之后，正常不会有这种竞态。
   */
  async function appendNote(content: string): Promise<void> {
    if (!sessionId) return;
    try {
      await agentSessionService.appendMessage({
        id: `msg-${Date.now()}-note`,
        sessionId,
        role: "assistant",
        content,
      });
    } catch (err) {
      error.value = `审批回执没能保存：${String(err)}`;
    }
  }

  return {
    sessions,
    currentId,
    loading,
    error,
    ensureSession,
    loadSessions,
    open,
    restoreLatest,
    startNew,
    createNew,
    rename,
    remove,
    persist,
    appendNote,
  };
}
