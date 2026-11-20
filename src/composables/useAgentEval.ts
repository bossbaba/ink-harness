import { computed, ref } from "vue";
import { type RunAgentEvalResult, runAgentEval } from "@/services/agentEval";
import { agentEvalService } from "@/services/agentEvalService";
import { agentRoleService, parseRoleTools } from "@/services/agentRoleService";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import type { AgentEvalCaseResult, AgentEvalRun, AgentRole, Project } from "@/types";

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

/**
 * Agent 评测页状态：选项（作品/角色）、跑分进度、最近一次结果与历史。
 *
 * 跑分是重操作（每个用例一次多轮对话），因此全程可取消，且一次只允许跑一轮；
 * 结果即时落库，历史按时间倒序展示，方便换模型后对比通过率。
 */
export function useAgentEval() {
  const projects = ref<Project[]>([]);
  const roles = ref<AgentRole[]>([]);
  const projectId = ref("");
  const roleId = ref("");
  const loading = ref(false);
  const running = ref(false);
  const progress = ref("");
  const error = ref("");
  const result = ref<RunAgentEvalResult | null>(null);
  const history = ref<AgentEvalRun[]>([]);

  /** 取消标记：跑分循环每轮开始前检查，点停止后剩余用例标记为跳过。 */
  let cancelled = false;

  const canRun = computed(() => !running.value && projectId.value !== "");
  const historyRows = computed(() =>
    history.value.map((run) => ({
      ...run,
      rate: run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0,
      cases: parseDetails(run.details),
    })),
  );

  /** 拉取作品、角色与历史；单块失败不阻塞其余，页面能继续用。 */
  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    const failures: string[] = [];
    const [projectList, roleList, runs] = await Promise.all([
      projectService.list().catch((err: unknown) => {
        failures.push(`作品列表（${String(err)}）`);
        return [] as Project[];
      }),
      agentRoleService.list().catch((err: unknown) => {
        failures.push(`角色列表（${String(err)}）`);
        return [] as AgentRole[];
      }),
      agentEvalService.list(20).catch((err: unknown) => {
        failures.push(`评测历史（${String(err)}）`);
        return [] as AgentEvalRun[];
      }),
    ]);
    projects.value = projectList;
    roles.value = roleList;
    history.value = runs;
    if (!projectId.value && projectList.length > 0) projectId.value = projectList[0].id;
    if (failures.length > 0) error.value = `部分数据读取失败：${failures.join("、")}`;
    loading.value = false;
  }

  /** 运行评测：准备作品/章节上下文，按所选角色裁剪工具，跑完写库并刷新历史。 */
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
    progress.value = "准备中…";

    try {
      // 章节只用于「读当前章」用例：取大纲里第一项，没有章节时该用例自动跳过。
      const snapshot = await outlineService.snapshot(project.id).catch(() => null);
      const chapter = snapshot?.chapters[0];
      // 模型可能在别的页面刚改过配置，这里刷新一次，避免按旧能力判断走错轨道。
      await modelRouter.refresh();
      const selected = modelRouter.select({ task: "copilot", privacy: project.privacy });
      const supportsTools = selected?.capabilities.tools === true;
      const role = roles.value.find((item) => item.id === roleId.value) ?? null;

      const runResult = await runAgentEval({
        ctx: {
          project,
          chapterId: chapter?.id,
          chapterTitle: chapter?.title,
        },
        toolNames: parseRoleTools(role),
        extraPrompt: role?.prompt ?? "",
        supportsTools,
        onProgress: (done, total, title) => {
          progress.value = title
            ? `${done}/${total} · 正在跑：${title}`
            : `${done}/${total} · 完成`;
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
      progress.value = "";
    }
  }

  /** 取消：只置标记，当前用例跑完后循环会在下一例开始前退出。 */
  function cancel(): void {
    cancelled = true;
    progress.value = "正在停止…";
  }

  return {
    projects,
    roles,
    projectId,
    roleId,
    loading,
    running,
    progress,
    error,
    result,
    history,
    historyRows,
    canRun,
    load,
    run,
    cancel,
  };
}
