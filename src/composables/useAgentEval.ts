import { computed, ref } from "vue";
import {
  AGENT_EVAL_CASES,
  AGENT_EVAL_REVIEW_CASE,
  type RunAgentEvalResult,
  runAgentEval,
} from "@/services/agentEval";
import { agentEvalService } from "@/services/agentEvalService";
import { agentRoleService, parseRoleTools } from "@/services/agentRoleService";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import type {
  AgentEvalCaseResult,
  AgentEvalHistoryRow,
  AgentEvalProgressState,
  AgentEvalProgressStep,
  AgentEvalRun,
  AgentRole,
  Project,
} from "@/types";

/** 把落库的 details JSON 解析回逐例明细；老记录或坏数据返回空数组，不抛异常。 */
export function parseDetails(raw: string): AgentEvalCaseResult[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as AgentEvalCaseResult[]) : [];
  } catch {
    return [];
  }
}

/** 通过率统一按此口径计算，避免结果区和历史区各算一套对不上。 */
function passRate(passed: number, total: number): number {
  return total > 0 ? Math.round((passed / total) * 100) : 0;
}

/**
 * Agent 评测页状态：选项（作品/章节/角色）、跑分进度、最近一次结果与历史趋势。
 *
 * 跑分是重操作（每个用例一次多轮对话），因此全程可取消，且一次只允许跑一轮；
 * 结果即时落库，历史按时间倒序展示，并用「本次 vs 上次」的通过率差回答
 * 「换模型/改提示词之后到底变好还是变差」这个评测初衷。
 */
export function useAgentEval() {
  const projects = ref<Project[]>([]);
  const roles = ref<AgentRole[]>([]);
  const projectId = ref("");
  const roleId = ref("");
  /** 评测用章节：默认第一项，作者可换成真正要验证的那一章；空串表示不指定。 */
  const chapterId = ref("");
  const chapters = ref<Array<{ id: string; title: string }>>([]);
  /** 审稿用例开关：默认关，它内部再调一次模型，跑一轮约双倍耗时。 */
  const includeReview = ref(false);
  const loading = ref(false);
  const running = ref(false);
  /** 结构化进度：界面据此画进度条与用例步骤，不再是只能塞在一行里的文案。 */
  const progressState = ref<AgentEvalProgressState>({
    phase: "idle",
    done: 0,
    total: 0,
    title: "",
  });
  const error = ref("");
  const result = ref<RunAgentEvalResult | null>(null);
  const history = ref<AgentEvalRun[]>([]);
  /** 跑分开始前记下的上一次通过率，用于本次结果对比；不受本次落库影响。 */
  const previousRate = ref<number | null>(null);

  /** 取消标记：跑分循环每轮开始前检查，点停止后剩余用例标记为跳过。 */
  let cancelled = false;

  const canRun = computed(() => !running.value && projectId.value !== "");
  const historyRows = computed<AgentEvalHistoryRow[]>(() => {
    // history 已按作品过滤且时间倒序：当前项的「上一次」就是紧随其后的那一条。
    return history.value.map((run, index) => {
      const prior = history.value[index + 1];
      const rate = passRate(run.passed, run.total);
      return {
        ...run,
        rate,
        cases: parseDetails(run.details),
        delta: prior ? rate - passRate(prior.passed, prior.total) : null,
      };
    });
  });

  /** 本次通过率与上一次的差值；null 表示没有可比的历史。 */
  const rateDelta = computed(() => {
    if (!result.value || previousRate.value === null) return null;
    return passRate(result.value.passed, result.value.cases.length) - previousRate.value;
  });

  /** 兼容原来的一行文案，便于日志与其它调用方继续按字符串读取。 */
  const progress = computed(() => {
    const state = progressState.value;
    if (state.phase === "preparing") return "准备中…";
    if (state.phase === "stopping") return "正在停止…";
    if (state.phase === "running") {
      return state.title
        ? `${state.done}/${state.total} · 正在跑：${state.title}`
        : "正在整理结果…";
    }
    return "";
  });

  /** 进度条百分比：准备阶段为 0，最后一个用例结束后立刻到 100。 */
  const progressPercent = computed(() => {
    const state = progressState.value;
    return state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : 0;
  });

  /** 把用例标题按已完成数标成「已完成 / 进行中 / 待运行」，不另存一份状态。 */
  const progressSteps = computed<AgentEvalProgressStep[]>(() => {
    const titles = AGENT_EVAL_CASES.map((item) => item.title);
    if (includeReview.value) titles.push(AGENT_EVAL_REVIEW_CASE.title);
    const { done, phase } = progressState.value;
    return titles.map((title, index) => ({
      title,
      status: index < done ? "done" : index === done && phase !== "idle" ? "active" : "pending",
    }));
  });

  /**
   * 加载某个作品范围内的章节与历史。
   * 切作品时必须重取：章节属于新作品，历史也只该显示该作品的跑分，
   * 否则「上次通过率」会拿别的作品做基线，趋势对比完全失真。
   */
  async function loadScoped(id: string): Promise<void> {
    chapterId.value = "";
    chapters.value = [];
    history.value = [];
    previousRate.value = null;
    result.value = null;
    if (!id) return;
    const [snapshot, runs] = await Promise.all([
      outlineService.snapshot(id).catch(() => null),
      agentEvalService.list(20, id).catch(() => [] as AgentEvalRun[]),
    ]);
    chapters.value = (snapshot?.chapters ?? []).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
    }));
    chapterId.value = chapters.value[0]?.id ?? "";
    history.value = runs;
    previousRate.value = runs.length > 0 ? passRate(runs[0].passed, runs[0].total) : null;
  }

  /** NSelect 的显式变更入口：v-model 换成 :value + 此回调，避免 watch 与首屏加载重复取数。 */
  async function handleProjectChange(id: string): Promise<void> {
    if (running.value || id === projectId.value) return;
    projectId.value = id;
    await loadScoped(id);
  }

  /** 拉取作品、角色与当前作品的历史；单块失败不阻塞其余，页面能继续用。 */
  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    const failures: string[] = [];
    const [projectList, roleList] = await Promise.all([
      projectService.list().catch((err: unknown) => {
        failures.push(`作品列表（${String(err)}）`);
        return [] as Project[];
      }),
      agentRoleService.list().catch((err: unknown) => {
        failures.push(`角色列表（${String(err)}）`);
        return [] as AgentRole[];
      }),
    ]);
    projects.value = projectList;
    roles.value = roleList;
    if (!projectId.value && projectList.length > 0) projectId.value = projectList[0].id;
    await loadScoped(projectId.value);
    if (failures.length > 0) error.value = `部分数据读取失败：${failures.join("、")}`;
    loading.value = false;
  }

  /** 运行评测：按所选章节准备上下文，按角色裁剪工具，跑完写库并刷新历史。 */
  async function run(): Promise<void> {
    if (!canRun.value) return;
    const project = projects.value.find((item) => item.id === projectId.value);
    if (!project) {
      error.value = "所选作品不存在，请刷新后重试。";
      return;
    }
    running.value = true;
    cancelled = false;
    error.value = "";
    result.value = null;
    // 用例数在准备阶段就确定：进度条的分母先给出来，避免一开始就显示 0/0。
    progressState.value = {
      phase: "preparing",
      done: 0,
      total: AGENT_EVAL_CASES.length + (includeReview.value ? 1 : 0),
      title: "",
    };

    try {
      // 章节由作者指定；选「不指定章节」时读章节用例自动跳过。
      const chapter = chapters.value.find((item) => item.id === chapterId.value);
      // 基线必须在本次落库之前取，否则 history[0] 就是这次自己，差值永远是 0。
      previousRate.value =
        history.value.length > 0 ? passRate(history.value[0].passed, history.value[0].total) : null;
      // 模型可能在别的页面刚改过配置，这里刷新一次，避免按旧能力判断走错轨道。
      await modelRouter.refresh();
      const selected = modelRouter.select({ task: "copilot", privacy: project.privacy });
      const supportsTools = selected?.capabilities.tools === true;
      const role = roles.value.find((item) => item.id === roleId.value) ?? null;
      // 审稿用例默认不跑：作者显式打开才纳入，避免误点一次就等双倍时间。
      const cases = includeReview.value
        ? [...AGENT_EVAL_CASES, AGENT_EVAL_REVIEW_CASE]
        : AGENT_EVAL_CASES;

      const runResult = await runAgentEval({
        ctx: {
          project,
          chapterId: chapter?.id,
          chapterTitle: chapter?.title,
        },
        toolNames: parseRoleTools(role),
        extraPrompt: role?.prompt ?? "",
        supportsTools,
        cases,
        onProgress: (done, total, title) => {
          // 最后一例结束时 title 为空：保留 100% 进度，文案由 progress 派生为「整理结果」。
          progressState.value = { phase: "running", done, total, title };
        },
        shouldStop: () => cancelled,
      });
      result.value = runResult;

      // 落库失败不影响本次结果展示，只提示历史没存上。
      try {
        const saved = await agentEvalService.save({
          projectId: project.id,
          roleId: role?.id ?? "",
          roleName: role?.name ?? "默认角色",
          model: runResult.model,
          total: runResult.cases.length,
          passed: runResult.passed,
          rounds: runResult.rounds,
          tokens: runResult.tokens,
          durationMs: runResult.durationMs,
          details: JSON.stringify(runResult.cases),
        });
        history.value = [saved, ...history.value].slice(0, 20);
      } catch (err) {
        error.value = `评测已完成，但保存历史失败：${String(err)}`;
      }
    } catch (err) {
      error.value = `运行评测失败：${String(err)}`;
    } finally {
      running.value = false;
      progressState.value = { phase: "idle", done: 0, total: 0, title: "" };
    }
  }

  /** 取消：只置标记，当前用例跑完后循环会在下一例开始前退出。 */
  function cancel(): void {
    cancelled = true;
    progressState.value = { ...progressState.value, phase: "stopping" };
  }

  return {
    projects,
    roles,
    projectId,
    roleId,
    chapterId,
    chapters,
    includeReview,
    loading,
    running,
    progress,
    progressState,
    progressPercent,
    progressSteps,
    error,
    result,
    history,
    historyRows,
    rateDelta,
    canRun,
    load,
    run,
    cancel,
    handleProjectChange,
  };
}
