import { computed, ref } from "vue";
import { tauriApi } from "@/api/tauri";
import { modelRouter } from "@/services/modelRouter";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { applyReviewEdits } from "@/services/reviewApply";
import {
  buildReviewMessages,
  consistencyToIssues,
  parseReviewIssues,
  sortReviewIssues,
} from "@/services/reviewService";
import { storyElementService } from "@/services/storyElementService";
import { writingService } from "@/services/writingService";
import { useDraftSyncStore } from "@/stores/draftSync";
import type {
  Chapter,
  Project,
  ReviewDecision,
  ReviewIssue,
  ReviewLayer,
  ReviewReport,
  ReviewScope,
} from "@/types";
import { documentToPlainText, EMPTY_DOCUMENT_TEXT } from "@/utils/tiptap";

/**
 * 作品审稿：确定性一致性检查 + 模型审结构/语言，合成一份三层报告。
 *
 * 报告不落库——审稿是「看完就去改」的一次性动作，把结果留在库里反而会过期；
 * 需要留存时页面上可以复制成 Markdown。
 */
export function useProjectReview(projectId: string) {
  const draftSync = useDraftSyncStore();
  const project = ref<Project | null>(null);
  const chapters = ref<Chapter[]>([]);
  const loading = ref(false);
  const loadError = ref("");

  const scope = ref<ReviewScope>("chapter");
  const chapterId = ref("");

  const running = ref(false);
  /** 当前阶段文案（读取正文 / 检查设定 / 模型审阅中），让长任务不至于像卡死。 */
  const progress = ref("");
  /** 模型已返回的字数：审稿输出是 JSON，不给作者看原文，但得让他知道还在动。 */
  const received = ref(0);
  const error = ref("");
  const report = ref<ReviewReport | null>(null);
  const applying = ref(false);
  /** 应用结果要说明「改了几处、几处没定位到」，而不是只弹一句成功。 */
  const applyNotice = ref("");

  // 取消或重新审读时自增：旧请求迟到的分片直接丢弃。
  let requestSeq = 0;

  const currentChapter = computed(
    () => chapters.value.find((chapter) => chapter.id === chapterId.value) ?? null,
  );

  const canRun = computed(() => {
    if (running.value || loading.value || !project.value) return false;
    if (scope.value === "book") return chapters.value.length > 0;
    return Boolean(chapterId.value);
  });

  /** 按层分组，页面直接拿三层数据渲染，不用自己 filter。 */
  const grouped = computed<Record<ReviewLayer, ReviewIssue[]>>(() => {
    const issues = report.value?.issues ?? [];
    return {
      structure: issues.filter((issue) => issue.layer === "structure"),
      consistency: issues.filter((issue) => issue.layer === "consistency"),
      language: issues.filter((issue) => issue.layer === "language"),
    };
  });

  /** 采纳数含已应用：作者点过「接受」的都算，避免应用后计数突然归零。 */
  const acceptedCount = computed(
    () =>
      report.value?.issues.filter(
        (issue) => issue.decision === "accepted" || issue.decision === "applied",
      ).length ?? 0,
  );
  const rejectedCount = computed(
    () => report.value?.issues.filter((issue) => issue.decision === "rejected").length ?? 0,
  );
  /** 真正能一键写回的：已采纳、有原文片段、也有可直接替换的文本。 */
  const applyableCount = computed(
    () =>
      report.value?.issues.filter(
        (issue) => issue.decision === "accepted" && Boolean(issue.quote && issue.replacement),
      ).length ?? 0,
  );

  /** 章节下拉的选项：幕次写进标签，避免同名章节分不清。 */
  const chapterOptions = computed(() =>
    chapters.value.map((chapter) => ({
      label: `第${chapter.act}幕 · ${chapter.title}`,
      value: chapter.id,
    })),
  );

  async function load(): Promise<void> {
    if (!projectId) {
      loadError.value = "缺少作品 ID。";
      return;
    }
    loading.value = true;
    loadError.value = "";
    try {
      const [detail, snapshot] = await Promise.all([
        projectService.get(projectId),
        outlineService.snapshot(projectId),
      ]);
      project.value = detail;
      chapters.value = snapshot.chapters;
      if (!chapterId.value && snapshot.chapters.length > 0) {
        chapterId.value = snapshot.chapters[0].id;
      }
      // 全书没有章节时退化成「本章」，否则运行按钮永远点不动也说不清原因。
      if (snapshot.chapters.length === 0) scope.value = "chapter";
    } catch (err) {
      loadError.value = `读取作品失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 关页面或切范围时清掉旧报告，避免把上一章的结论当成这一章的。 */
  function reset(): void {
    requestSeq += 1;
    running.value = false;
    progress.value = "";
    received.value = 0;
    error.value = "";
    report.value = null;
    applying.value = false;
    applyNotice.value = "";
  }

  function formatNow(): string {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }

  async function run(): Promise<void> {
    if (!canRun.value) return;
    const current = project.value;
    if (!current) return;

    const seq = ++requestSeq;
    error.value = "";
    report.value = null;
    received.value = 0;
    running.value = true;

    try {
      // 一致性检查是确定性的、不花钱，先跑；失败了也不该拦住模型审稿。
      progress.value = "检查设定一致性…";
      const consistency = await storyElementService.checkConsistency(projectId).catch(() => []);
      if (seq !== requestSeq) return;
      const baseIssues = consistencyToIssues(consistency);

      let chapterText = "";
      let target = "";
      if (scope.value === "chapter") {
        const chapter = currentChapter.value;
        if (!chapter) throw new Error("请先选择要审读的章节。");
        target = `第${chapter.act}幕 · ${chapter.title}`;
        progress.value = "读取本章正文…";
        const content = await writingService.getContent(chapter.id);
        const text = documentToPlainText(content.content);
        chapterText = text === EMPTY_DOCUMENT_TEXT ? "" : text;
        if (!chapterText.trim()) throw new Error("这一章还没有正文，先写一点再来审。");
      } else {
        target = `全书概览（${chapters.value.length} 章）`;
      }
      if (seq !== requestSeq) return;

      progress.value = "读取设定与大纲…";
      const context = await tauriApi.buildProjectContext(projectId);
      if (seq !== requestSeq) return;

      // Provider 可能刚在模型管理页改过，每次审读前刷新一次。
      await modelRouter.refresh();
      if (seq !== requestSeq) return;
      const model = modelRouter.select({ task: "review", privacy: current.privacy, projectId });
      if (!model) throw new Error("没有可用模型，请先在模型管理里配置并启用 Provider。");

      progress.value = "模型审阅中…";
      let raw = "";
      const handle = modelRouter.chat(
        { task: "review", privacy: current.privacy, projectId },
        buildReviewMessages({
          project: current,
          scope: scope.value,
          chapterTitle: target,
          chapterSummary: scope.value === "chapter" ? (currentChapter.value?.summary ?? "") : "",
          chapterText,
          chapters: chapters.value,
          context,
        }),
        (chunk) => {
          if (seq !== requestSeq) return;
          if (!chunk.delta) return;
          raw += chunk.delta;
          received.value = raw.length;
        },
        (message) => {
          if (seq !== requestSeq) return;
          error.value = message;
        },
      );
      await handle.done.catch(() => undefined);
      if (seq !== requestSeq) return;
      if (!raw.trim()) {
        error.value = error.value || "模型没有返回内容，可以再试一次。";
        return;
      }

      const aiIssues = parseReviewIssues(raw);
      report.value = {
        scope: scope.value,
        target,
        issues: sortReviewIssues([...baseIssues, ...aiIssues]),
        model: `${model.provider}:${model.id}`,
        // 解析不出条目时保留原文：至少作者能看到模型说了什么，而不是一个空报告。
        raw: aiIssues.length === 0 ? raw : "",
        createdAt: formatNow(),
      };
      if (aiIssues.length === 0) {
        error.value = "模型的输出没能解析成条目，已把原文留在下面，可复制出来手工整理。";
      }
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === requestSeq) {
        running.value = false;
        progress.value = "";
      }
    }
  }

  /** 停止审读：模型输出是 JSON，半截没有意义，直接丢弃即可。 */
  function stop(): void {
    requestSeq += 1;
    running.value = false;
    progress.value = "";
  }

  /** 再点一次同一个决定就回到待定；写回正文后不再改，免得报告与正文对不上。 */
  function decide(id: string, decision: ReviewDecision): void {
    const issue = report.value?.issues.find((item) => item.id === id);
    if (!issue || issue.decision === "applied") return;
    issue.decision = issue.decision === decision ? "pending" : decision;
    applyNotice.value = "";
  }

  function setComment(id: string, comment: string): void {
    const issue = report.value?.issues.find((item) => item.id === id);
    if (issue) issue.comment = comment;
  }

  /** 把采纳且有替换文本的条目写回本章正文，并留一版快照供回退。 */
  async function applyAccepted(): Promise<void> {
    const current = report.value;
    if (current?.scope !== "chapter" || !chapterId.value || applying.value) return;
    const edits = current.issues
      .filter((issue) => issue.decision === "accepted" && issue.quote && issue.replacement)
      .map((issue) => ({
        id: issue.id,
        quote: issue.quote,
        replacement: issue.replacement,
      }));
    if (edits.length === 0) return;

    applying.value = true;
    applyNotice.value = "";
    try {
      const data = await writingService.getContent(chapterId.value);
      const result = applyReviewEdits(data.content, edits);
      if (result.appliedIds.length > 0) {
        await writingService.saveContent({
          chapterId: chapterId.value,
          content: result.content,
          wordCount: result.wordCount,
          snapshot: true,
        });
        // 写作台可能还停在缓存里的旧正文，这里递增版本让它回来时重读。
        draftSync.bump(chapterId.value);
        const applied = new Set(result.appliedIds);
        for (const issue of current.issues) {
          if (applied.has(issue.id)) issue.decision = "applied";
        }
      }
      const failed = result.failedIds.length;
      applyNotice.value = result.appliedIds.length
        ? `已写回 ${result.appliedIds.length} 处${failed ? `，另有 ${failed} 处没找到原文，请手工改` : ""}。`
        : `${failed} 处都没找到原文，请回写作台手工改。`;
    } catch (err) {
      applyNotice.value = `写入正文失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      applying.value = false;
    }
  }

  return {
    project,
    chapters,
    loading,
    loadError,
    scope,
    chapterId,
    chapterOptions,
    currentChapter,
    canRun,
    running,
    progress,
    received,
    error,
    report,
    grouped,
    acceptedCount,
    rejectedCount,
    applyableCount,
    applying,
    applyNotice,
    load,
    run,
    stop,
    reset,
    decide,
    setComment,
    applyAccepted,
  };
}
