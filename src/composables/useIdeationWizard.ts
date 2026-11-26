import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ideationDraftService } from "@/services/ideationDraftService";
import {
  buildIdeationMessages,
  createEmptyProposal,
  createIdeationAnswers,
  parseProposal,
} from "@/services/ideationService";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { useProjectStore } from "@/stores/project";
import type { IdeaProposal, IdeationAnswers, IdeationDraftInput, Project } from "@/types";

/**
 * 构思向导：四步访谈 → AI 生成方案 → 写入作品（可选三幕骨架）。
 * 作品 ID 来自路由参数；缺失或作品不存在时停止后续操作。
 */
export function useIdeationWizard(projectId: string) {
  // 当前作品来自全局 store：别的页面改了作品状态，这里能立刻看到。
  const project = storeToRefs(useProjectStore()).current;
  const answers = ref<IdeationAnswers>(createIdeationAnswers({ genre: "", audience: "" }));
  const step = ref(0);
  const maxStep = ref(0);

  const proposal = ref<IdeaProposal | null>(null);
  const selectedTitle = ref("");
  const includeOutline = ref(true);

  const generating = ref(false);
  const applying = ref(false);
  const applied = ref(false);
  const outlineCreated = ref(false);
  const streamText = ref("");
  const parseError = ref("");
  const modelLabel = ref("");
  const error = ref("");
  /** 草稿最近一次落库时间；空串表示还没保存过，界面据此显示「已自动保存 / 未保存」。 */
  const draftSavedAt = ref("");
  /** 草稿读写失败单独提示：它不影响向导主流程，不该覆盖主错误区。 */
  const draftError = ref("");

  // 草稿恢复完成前不写库：恢复本身会改一堆 ref，不拦住会立刻把旧值原样写回去。
  let draftReady = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const canNext = computed(() => {
    if (step.value === 0) return answers.value.inspiration.trim().length > 0;
    if (step.value === 1) return answers.value.protagonist.trim().length > 0;
    return true;
  });

  const canApply = computed(() => {
    const value = proposal.value;
    if (!value || applying.value || applied.value) return false;
    return Boolean(selectedTitle.value.trim() || value.premise || value.synopsis);
  });

  const outlineSummary = computed(() => {
    const acts = proposal.value?.outline ?? [];
    const chapters = acts.reduce((sum, act) => sum + act.chapters.length, 0);
    const scenes = acts.reduce(
      (sum, act) => sum + act.chapters.reduce((inner, chapter) => inner + chapter.scenes.length, 0),
      0,
    );
    return { chapters, scenes };
  });

  function goStep(index: number): void {
    if (generating.value || applying.value) return;
    if (index < 0 || index > maxStep.value) return;
    step.value = index;
  }

  function next(): void {
    if (!canNext.value || step.value >= 2) return;
    step.value += 1;
    maxStep.value = Math.max(maxStep.value, step.value);
  }

  function prev(): void {
    if (applying.value || generating.value) return;
    step.value = Math.max(0, step.value - 1);
  }

  /** 组装当前草稿；projectId 缺失时不写库（向导本来就打不开）。 */
  function buildDraftInput(): IdeationDraftInput | null {
    if (!projectId) return null;
    return {
      projectId,
      answers: answers.value,
      proposal: proposal.value,
      step: step.value,
      maxStep: maxStep.value,
      selectedTitle: selectedTitle.value,
      includeOutline: includeOutline.value,
      applied: applied.value,
      outlineCreated: outlineCreated.value,
    };
  }

  /** 真正写库；失败只提示，不打断作者继续填写。 */
  async function persistDraft(): Promise<void> {
    const input = buildDraftInput();
    if (!input || !draftReady) return;
    try {
      draftSavedAt.value = await ideationDraftService.save(input);
      draftError.value = "";
    } catch (err) {
      draftError.value = `草稿保存失败：${String(err)}`;
    }
  }

  /** 防抖 600ms：连续敲字时不至于每个按键都发一次 IPC。 */
  function scheduleSave(): void {
    if (!draftReady) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistDraft();
    }, 600);
  }

  /** 立即落库（离开页面时调用）：让「切页不丢」真正成立，而不是等下一次防抖。 */
  function flushDraft(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void persistDraft();
  }

  /**
   * 恢复上次的访谈答案、方案与步骤。
   * 答案用默认结构兜底后再合并：旧草稿可能缺字段（问卷加过题），直接覆盖会写出 undefined。
   */
  async function restoreDraft(): Promise<void> {
    try {
      const draft = await ideationDraftService.load(projectId);
      if (!draft) return;
      if (draft.answers) {
        const base = createIdeationAnswers({
          genre: draft.answers.genre ?? "",
          audience: draft.answers.audience ?? "",
        });
        answers.value = { ...base, ...draft.answers };
      }
      proposal.value = draft.proposal;
      step.value = Math.min(3, Math.max(0, draft.step));
      // 有方案时「方案确认」这一步必须可达，否则恢复后步骤条点不回去。
      maxStep.value = Math.min(3, Math.max(draft.maxStep, draft.step, draft.proposal ? 3 : 0));
      selectedTitle.value = draft.selectedTitle;
      includeOutline.value = draft.includeOutline;
      applied.value = draft.applied;
      outlineCreated.value = draft.outlineCreated;
      draftSavedAt.value = draft.updatedAt;
      draftError.value = "";
    } catch (err) {
      draftError.value = `草稿读取失败：${String(err)}`;
    }
  }

  // 访谈、步骤、方案、写入状态任何一项变化都排队保存；恢复期间 draftReady=false 自动跳过。
  watch(
    [answers, step, maxStep, proposal, selectedTitle, includeOutline, applied, outlineCreated],
    scheduleSave,
    { deep: true },
  );
  onBeforeUnmount(flushDraft);

  /** 清空生成结果，允许重新构思；作品已写入的内容不会被回滚。 */
  function resetProposal(): void {
    proposal.value = null;
    selectedTitle.value = "";
    streamText.value = "";
    parseError.value = "";
    applied.value = false;
    outlineCreated.value = false;
    step.value = 2;
    maxStep.value = 2;
  }

  async function generate(): Promise<void> {
    if (!project.value || generating.value) return;
    step.value = 3;
    maxStep.value = 3;
    generating.value = true;
    applied.value = false;
    parseError.value = "";
    streamText.value = "";
    proposal.value = null;
    selectedTitle.value = "";

    try {
      // 每次生成前刷新 Provider 缓存，用户刚在模型管理页启用模型也能立即生效。
      await modelRouter.refresh().catch(() => undefined);
      const ctx = {
        task: "ideation" as const,
        privacy: project.value.privacy,
        projectId: project.value.id,
      };
      const model = modelRouter.select(ctx);
      if (!model) {
        proposal.value = createEmptyProposal();
        parseError.value = "尚未启用可用模型，请先到模型管理中启用一个模型，或手动填写方案。";
        return;
      }
      modelLabel.value = model.displayName;

      let errorText = "";
      const handle = modelRouter.chat(
        ctx,
        buildIdeationMessages(answers.value),
        (chunk) => {
          if (chunk.delta) streamText.value += chunk.delta;
        },
        (message) => {
          errorText = message;
        },
      );
      await handle.done.catch((err: unknown) => {
        errorText = errorText || String(err);
      });

      if (errorText) {
        proposal.value = createEmptyProposal();
        parseError.value = errorText;
        return;
      }

      const parsed = parseProposal(streamText.value);
      if (!parsed) {
        proposal.value = createEmptyProposal();
        parseError.value = "AI 返回内容不是可解析的方案，已切换为手动填写模式，也可以重新生成。";
        return;
      }
      proposal.value = parsed;
      selectedTitle.value = parsed.titles[0] ?? "";
    } catch (err) {
      proposal.value = proposal.value ?? createEmptyProposal();
      parseError.value = String(err);
    } finally {
      generating.value = false;
    }
  }

  /** 写入作品：标题/梗概/读者画像/风格 + 可选三幕章节与场景。 */
  async function apply(): Promise<void> {
    const current = project.value;
    const value = proposal.value;
    if (!current || !value || !canApply.value) return;

    applying.value = true;
    error.value = "";
    const hasOutline = includeOutline.value && value.outline.some((act) => act.chapters.length > 0);
    try {
      const title = selectedTitle.value.trim() || current.title;
      const nextProject: Project = {
        ...current,
        title,
        premise: value.premise || current.premise,
        audience: value.audience || current.audience,
        style: value.style || current.style,
        // 只有从「构思」阶段真的写入章节才推进到大纲；
        // 已经在写作/已发布的作品不能被导回大纲阶段。
        status: hasOutline && current.status === "idea" ? "outline" : current.status,
      };
      await projectService.update(nextProject);
      project.value = nextProject;

      if (hasOutline) {
        for (const act of value.outline) {
          for (const chapter of act.chapters) {
            const created = await outlineService.createChapter({
              projectId: current.id,
              act: act.act,
              title: chapter.title,
              summary: chapter.summary,
              status: "planned",
            });
            for (const scene of chapter.scenes) {
              await outlineService.createScene(
                {
                  chapterId: created.id,
                  title: scene.title,
                  pov: scene.pov,
                  location: scene.location,
                  timeMark: scene.timeMark,
                  summary: scene.summary,
                },
                current.id,
              );
            }
          }
        }
      }

      outlineCreated.value = hasOutline;
      applied.value = true;
    } catch (err) {
      // 章节是逐条创建的：中途失败时前面几条已经落库，必须说清楚，
      // 否则用户会直接重试，把已经写进去的章节再建一遍。
      error.value = hasOutline
        ? `写入中断：${String(err)}。已创建的章节会保留，请先到大纲页确认再补齐，不要直接重复写入。`
        : `写入失败：${String(err)}`;
    } finally {
      applying.value = false;
    }
  }

  onMounted(async () => {
    if (!projectId) {
      error.value = "缺少作品 ID，无法打开构思向导。";
      return;
    }
    try {
      const found = await projectService.get(projectId);
      if (!found) {
        error.value = "作品不存在或已删除。";
        return;
      }
      project.value = found;
      answers.value = createIdeationAnswers({
        genre: found.genre,
        audience: found.audience,
      });
      // 先恢复草稿再开门闩：恢复本身会改一堆 ref，不拦住会立刻把旧值原样写回去。
      await restoreDraft();
      draftReady = true;
      await modelRouter.refresh().catch(() => undefined);
    } catch (err) {
      error.value = `读取作品失败：${String(err)}`;
    }
  });

  return {
    project,
    answers,
    step,
    maxStep,
    proposal,
    selectedTitle,
    includeOutline,
    generating,
    applying,
    applied,
    outlineCreated,
    streamText,
    parseError,
    modelLabel,
    error,
    draftSavedAt,
    draftError,
    canNext,
    canApply,
    outlineSummary,
    goStep,
    next,
    prev,
    resetProposal,
    generate,
    apply,
  };
}
