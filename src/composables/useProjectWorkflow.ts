import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { parseProposal } from "@/services/ideationService";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { parsePublicationBrief } from "@/services/publicationBriefService";
import { parseReviewIssues, reviewToMarkdown } from "@/services/reviewService";
import {
  buildStageMessages,
  decideStage,
  loadWorkflowState,
  requestAgent,
  saveWorkflowState,
} from "@/services/workflowService";
import { writingService } from "@/services/writingService";
import { useDraftSyncStore } from "@/stores/draftSync";
import { useProjectStore } from "@/stores/project";
import type {
  Chapter,
  Project,
  ReviewReport,
  WorkflowDecision,
  WorkflowStage,
  WorkflowState,
} from "@/types";
import { WORKFLOW_CHAPTER_STAGES, WORKFLOW_STAGES } from "@/types";
import { countCharacters } from "@/utils/text";
import { documentToPlainText, plainTextToDocument } from "@/utils/tiptap";

/**
 * Agent 工作流：五个阶段顺序推进，每阶段先出候选产物，人工审批通过才落地并解锁下一阶段。
 * 状态存在 app_meta（见 workflowService），复用已有构思/审稿/出版服务，不新增数据表与命令。
 */
export function useProjectWorkflow(projectId: string) {
  // 当前作品来自全局 store：别的页面改了作品状态，这里能立刻看到。
  const project = storeToRefs(useProjectStore()).current;
  const draftSync = useDraftSyncStore();
  const chapters = ref<Chapter[]>([]);
  const state = ref<WorkflowState | null>(null);
  const loading = ref(false);
  const loadError = ref("");
  const running = ref<WorkflowStage | null>(null);
  const received = ref(0);
  const busy = ref(false);
  const error = ref("");
  const notice = ref("");

  const context = ref("");
  let requestSeq = 0;

  const activeStage = computed<WorkflowStage | null>(() => {
    if (!state.value) return null;
    const current = WORKFLOW_STAGES.find(
      (item) => state.value?.stages[item.key].status !== "approved",
    );
    return current?.key ?? null;
  });

  const selectedChapter = computed(
    () => chapters.value.find((item) => item.id === state.value?.selectedChapterId) ?? null,
  );

  /** 前置阶段没通过时，后续阶段不可运行——这是流水线的人工审批闸门。 */
  function isUnlocked(stage: WorkflowStage): boolean {
    if (!state.value) return false;
    const index = WORKFLOW_STAGES.findIndex((item) => item.key === stage);
    if (index <= 0) return true;
    const previous = WORKFLOW_STAGES[index - 1];
    return state.value.stages[previous.key].status === "approved";
  }

  async function load(): Promise<void> {
    // 正在跑阶段/落地时不要重读：本轮 run/approve 手里的 state 才是准的，
    // 中途被缓存页回来的 load 覆盖，会导致落库时把刚改的选章、阶段状态写回旧值。
    if (running.value || busy.value) return;
    loading.value = true;
    loadError.value = "";
    try {
      const [found, snapshot, workflow, ctx] = await Promise.all([
        projectService.get(projectId),
        outlineService.snapshot(projectId),
        loadWorkflowState(projectId),
        outlineService.buildContext(projectId).catch(() => ""),
      ]);
      if (!found) {
        loadError.value = "作品不存在或已删除。";
        return;
      }
      project.value = found;
      chapters.value = snapshot.chapters;
      context.value = ctx;
      state.value = workflow;
    } catch (err) {
      loadError.value = `读取工作流失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 选章只影响写作/编辑，改动立即持久化；写失败要回滚，避免界面与落库状态不一致。 */
  async function selectChapter(chapterId: string): Promise<void> {
    if (!state.value) return;
    const previous = state.value.selectedChapterId;
    state.value.selectedChapterId = chapterId;
    try {
      await saveWorkflowState(projectId, state.value);
    } catch (err) {
      state.value.selectedChapterId = previous;
      loadError.value = `保存选章失败：${String(err)}`;
    }
  }

  async function readChapterText(chapterId: string): Promise<string> {
    const content = await writingService.getContent(chapterId);
    const text = documentToPlainText(content.content);
    return text === "（空白正文）" ? "" : text;
  }

  function chapterDigest(): string {
    return chapters.value
      .map((item) => `第${item.act}幕 · ${item.title}（${item.wordCount} 字）：${item.summary}`)
      .join("\n");
  }

  /** 运行一个阶段：组装提示词 → 流式取全文 → 存入候选产物并切到待审批。 */
  async function run(stage: WorkflowStage): Promise<void> {
    const current = project.value;
    const workflow = state.value;
    if (!current || !workflow || running.value || busy.value) return;
    if (!isUnlocked(stage)) {
      error.value = "请先通过上一个阶段，再运行这一步。";
      return;
    }
    if (WORKFLOW_CHAPTER_STAGES.includes(stage) && !workflow.selectedChapterId) {
      error.value = "请先在上方选定要处理的章节。";
      return;
    }

    const ticket = ++requestSeq;
    running.value = stage;
    error.value = "";
    notice.value = "";
    received.value = 0;
    const target = workflow.stages[stage];
    target.status = "running";
    target.artifact = "";
    target.error = "";
    try {
      let chapterText = "";
      if (stage === "editing" && workflow.selectedChapterId)
        chapterText = await readChapterText(workflow.selectedChapterId);
      const messages = buildStageMessages({
        stage,
        project: current,
        chapter: selectedChapter.value,
        chapterText,
        context: context.value,
        previous: chapterDigest(),
      });
      const raw = await requestAgent(
        stage,
        { privacy: current.privacy, projectId: current.id },
        messages,
        (count) => {
          if (ticket === requestSeq) received.value = count;
        },
      );
      if (ticket !== requestSeq) return;
      target.artifact = raw;
      target.status = "pending";
      target.decision = "";
      target.note = "";
      await saveWorkflowState(projectId, workflow);
    } catch (err) {
      if (ticket !== requestSeq) return;
      target.status = "rejected";
      target.error = err instanceof Error ? err.message : String(err);
      // 打回状态同样要落库，否则刷新后阶段会停在「进行中」；写失败必须让用户看见，
      // 不能像以前那样吞掉——界面显示已打回、实际没保存是最难排查的状态。
      await saveWorkflowState(projectId, workflow).catch((saveErr: unknown) => {
        notice.value = `工作流状态保存失败：${String(saveErr)}，刷新后可能丢失本次结果。`;
      });
    } finally {
      if (ticket === requestSeq) {
        running.value = null;
        received.value = 0;
      }
    }
  }

  /** 策划落地：方案字段写回作品；无章节时按三幕骨架创建章节与场景。 */
  async function applyIdeation(raw: string): Promise<void> {
    const current = project.value;
    if (!current) return;
    const proposal = parseProposal(raw);
    if (!proposal) {
      notice.value = "方案解析失败，原文已保留，请手动整理后再用。";
      return;
    }
    const hasOutline = proposal.outline.some((act) => act.chapters.length > 0);
    const next: Project = {
      ...current,
      title: proposal.titles[0] || current.title,
      premise: proposal.premise || current.premise,
      audience: proposal.audience || current.audience,
      style: proposal.style || current.style,
      status: hasOutline && current.status === "idea" ? "outline" : current.status,
    };
    await projectService.update(next);
    project.value = next;

    if (hasOutline && chapters.value.length === 0) {
      for (const act of proposal.outline) {
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
      chapters.value = (await outlineService.snapshot(projectId)).chapters;
      context.value = await outlineService.buildContext(projectId).catch(() => "");
    }
  }

  /** 审稿落地：把 JSON 问题数组整理成 Markdown 报告存回产物，方便复制与阅读。 */
  function applyReview(raw: string): void {
    const issues = parseReviewIssues(raw);
    if (issues.length === 0) return;
    const report: ReviewReport = {
      scope: "book",
      target: `全书（${chapters.value.length} 章）`,
      issues,
      model: state.value?.stages.review.model ?? "",
      raw: "",
      createdAt: new Date().toISOString(),
    };
    const markdown = reviewToMarkdown(report);
    if (state.value) state.value.stages.review.artifact = markdown;
  }

  /** 审批：通过后先落地副作用，再写决定；落地失败则保留待审批，不推进流水线。 */
  async function approve(
    stage: WorkflowStage,
    decision: WorkflowDecision,
    note: string,
  ): Promise<void> {
    const workflow = state.value;
    const current = project.value;
    if (!workflow || !current || busy.value) return;
    const target = workflow.stages[stage];
    if (target.status !== "pending") return;

    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
      if (decision === "approved") {
        if (stage === "ideation") await applyIdeation(target.artifact);
        else if (stage === "writing" || stage === "editing") {
          if (!workflow.selectedChapterId)
            throw new Error("目标章节已不存在，请重新选择章节后再通过。");
          const chapter = chapters.value.find((item) => item.id === workflow.selectedChapterId);
          if (!chapter) throw new Error("目标章节已不存在，请重新选择章节后再通过。");
          const doc = plainTextToDocument(target.artifact);
          const words = countCharacters(target.artifact);
          // 先读一次正文拿到版本号：作者在这期间手改过就报冲突，不能悄悄覆盖。
          const current = await writingService.getContent(chapter.id);
          // 这一步是「整篇覆盖正文」：必须留一版旧稿，否则作者手写的内容被替换后无法恢复。
          await writingService.saveContent({
            chapterId: chapter.id,
            content: JSON.stringify(doc),
            wordCount: words,
            snapshot: true,
            expectedContentRevision: current.contentRevision,
          });
          // 写作台可能还缓存着旧正文：递增版本号，让它回来时重读，
          // 否则作者在写作台敲一个字就会用旧稿覆盖掉刚写回的正文。
          draftSync.bump(chapter.id);
          chapters.value = chapters.value.map((item) =>
            item.id === chapter.id ? { ...item, wordCount: words, status: "drafting" } : item,
          );
        } else if (stage === "review") {
          applyReview(target.artifact);
        } else if (stage === "publish") {
          const brief = parsePublicationBrief(target.artifact);
          if (!brief) notice.value = "物料解析失败，原文已保留，请手动整理。";
          const next: Project = { ...current, status: "published" };
          await projectService.update(next);
          project.value = next;
        }
      }
      decideStage(workflow, stage, decision, note);
      await saveWorkflowState(projectId, workflow);
      // 解析失败等落地提示要留着，不能只显示「已通过」——作者需要知道产物没完全写回。
      const done =
        decision === "approved"
          ? `${WORKFLOW_STAGES.find((s) => s.key === stage)?.label ?? ""}阶段已通过，下一步已解锁。`
          : "已打回，可在这一步重新生成。";
      notice.value = notice.value ? `${notice.value} ${done}` : done;
    } catch (err) {
      error.value = `审批落地失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      busy.value = false;
    }
  }

  return {
    project,
    chapters,
    state,
    loading,
    loadError,
    running,
    received,
    busy,
    error,
    notice,
    activeStage,
    selectedChapter,
    isUnlocked,
    load,
    selectChapter,
    run,
    approve,
  };
}
