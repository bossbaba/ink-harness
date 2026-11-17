import { computed, onMounted, ref } from "vue";
import {
  buildIdeationMessages,
  createEmptyProposal,
  createIdeationAnswers,
  parseProposal,
} from "@/services/ideationService";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import type { IdeaProposal, IdeationAnswers, Project } from "@/types";

/**
 * 构思向导：四步访谈 → AI 生成方案 → 写入作品（可选三幕骨架）。
 * 作品 ID 来自路由参数；缺失或作品不存在时停止后续操作。
 */
export function useIdeationWizard(projectId: string) {
  const project = ref<Project | null>(null);
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
        strategy: "cost" as const,
        privacy: project.value.privacy,
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
    try {
      const title = selectedTitle.value.trim() || current.title;
      const hasOutline =
        includeOutline.value && value.outline.some((act) => act.chapters.length > 0);
      const nextProject: Project = {
        ...current,
        title,
        premise: value.premise || current.premise,
        audience: value.audience || current.audience,
        style: value.style || current.style,
        // 只有真的写入章节才把阶段推进到大纲，否则保持原阶段。
        status: hasOutline ? "outline" : current.status,
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
              await outlineService.createScene({
                chapterId: created.id,
                title: scene.title,
                pov: scene.pov,
                location: scene.location,
                timeMark: scene.timeMark,
                summary: scene.summary,
              });
            }
          }
        }
      }

      outlineCreated.value = hasOutline;
      applied.value = true;
    } catch (err) {
      error.value = `写入失败：${String(err)}`;
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
