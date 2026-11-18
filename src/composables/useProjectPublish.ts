import { computed, ref } from "vue";
import { projectService } from "@/services/projectService";
import { parsePublicationBrief, requestPublicationBrief } from "@/services/publicationBriefService";
import {
  exportBytes,
  loadPublishDocument,
  renderExport,
  renderHtml,
  renderMarkdown,
} from "@/services/publishService";
import type {
  ExportFormat,
  ExportResult,
  PrivacyScope,
  PublicationBrief,
  PublishDocument,
  PublishEntry,
  PublishTemplate,
} from "@/types";

const PLAN_KEY = "ink-harness.publish.plan";
const AUTHOR_KEY = "ink-harness.publish.author";

interface SavedPlan {
  selected: string[];
  entries: PublishEntry[];
}

/** 发布计划只存在本机：它随作者换个浏览器就没了也无妨，不必污染作品库。 */
function loadPlan(): SavedPlan {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return { selected: [], entries: [] };
    const parsed = JSON.parse(raw) as Partial<SavedPlan>;
    return {
      selected: Array.isArray(parsed.selected) ? parsed.selected : [],
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { selected: [], entries: [] };
  }
}

/**
 * 出版中心：一次读齐正文 → 同一份数据做排版预览与多格式导出；
 * 发布物料走模型生成，发布计划只留在浏览器本地。
 */
export function useProjectPublish(projectId: string) {
  const doc = ref<PublishDocument | null>(null);
  const privacy = ref<PrivacyScope>("any");
  const loading = ref(false);
  const loadError = ref("");
  const author = ref(localStorage.getItem(AUTHOR_KEY) ?? "");

  const template = ref<PublishTemplate>("web");
  const format = ref<ExportFormat>("epub");
  const exporting = ref(false);
  const exportNotice = ref("");
  const lastExport = ref<ExportResult | null>(null);

  const brief = ref<PublicationBrief | null>(null);
  const briefRaw = ref("");
  const briefGenerating = ref(false);
  const briefReceived = ref(0);
  const briefError = ref("");

  const plan = ref<SavedPlan>(loadPlan());

  const previewHtml = computed(() => (doc.value ? renderHtml(doc.value, template.value) : ""));
  const previewMarkdown = computed(() =>
    doc.value ? renderMarkdown(doc.value, template.value) : "",
  );
  const readyCount = computed(
    () => doc.value?.chapters.filter((chapter) => chapter.text.trim()).length ?? 0,
  );

  function savePlan(): void {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan.value));
  }

  async function load(): Promise<void> {
    loading.value = true;
    loadError.value = "";
    try {
      const [project, document] = await Promise.all([
        projectService.get(projectId),
        loadPublishDocument(projectId),
      ]);
      privacy.value = project?.privacy ?? "any";
      // 作品库里没有「作者」字段，署名只在导出时带上，单独存本机。
      document.author = author.value;
      doc.value = document;
    } catch (err) {
      loadError.value = `读取作品失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  function setAuthor(value: string): void {
    author.value = value;
    localStorage.setItem(AUTHOR_KEY, value);
    if (doc.value) doc.value.author = value;
  }

  async function exportFile(): Promise<void> {
    if (!doc.value || exporting.value || format.value === "pdf") return;
    exporting.value = true;
    exportNotice.value = "";
    try {
      const bytes = renderExport(doc.value, format.value, template.value);
      const result = await exportBytes(bytes, format.value, doc.value.title || "作品");
      if (!result) {
        exportNotice.value = "已取消保存。";
        return;
      }
      lastExport.value = result;
      exportNotice.value = `已导出到 ${result.path}`;
    } catch (err) {
      exportNotice.value = `导出失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      exporting.value = false;
    }
  }

  /** 打印走系统对话框，由用户在里面选「另存为 PDF」，避免前端手搓中文字体嵌入。 */
  function printPdf(): void {
    if (!doc.value) return;
    const frame = window.document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    window.document.body.appendChild(frame);
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    win.document.open();
    win.document.write(renderHtml(doc.value, template.value));
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
      window.setTimeout(() => frame.remove(), 1000);
    };
  }

  async function generateBrief(): Promise<void> {
    if (!doc.value || briefGenerating.value) return;
    briefGenerating.value = true;
    briefError.value = "";
    briefReceived.value = 0;
    try {
      const raw = await requestPublicationBrief(doc.value, privacy.value, projectId, (count) => {
        briefReceived.value = count;
      });
      briefRaw.value = raw;
      brief.value = parsePublicationBrief(raw);
      if (!brief.value) briefError.value = "没能解析成物料，原文留在下面，可复制后手工整理。";
    } catch (err) {
      briefError.value = err instanceof Error ? err.message : String(err);
    } finally {
      briefGenerating.value = false;
    }
  }

  function copyBrief(): void {
    const value = brief.value;
    if (!value) return;
    const text = [
      `【简介】\n${value.blurb}`,
      `【标签】\n${value.tags.join(" / ")}`,
      `【封面需求】\n${value.coverBrief}`,
      `【投稿信】\n${value.queryLetter}`,
    ].join("\n\n");
    void navigator.clipboard.writeText(text);
  }

  function togglePlatform(key: string): void {
    const selected = plan.value.selected;
    plan.value = {
      ...plan.value,
      selected: selected.includes(key)
        ? selected.filter((item) => item !== key)
        : [...selected, key],
    };
    savePlan();
  }

  function setEntry(platform: string, patch: Partial<PublishEntry>): void {
    const old = plan.value.entries.find((entry) => entry.platform === platform);
    const next: PublishEntry = {
      platform,
      date: patch.date ?? old?.date ?? "",
      note: patch.note ?? old?.note ?? "",
    };
    plan.value = {
      ...plan.value,
      entries: [...plan.value.entries.filter((entry) => entry.platform !== platform), next],
    };
    savePlan();
  }

  return {
    doc,
    loading,
    loadError,
    author,
    template,
    format,
    exporting,
    exportNotice,
    lastExport,
    brief,
    briefRaw,
    briefGenerating,
    briefReceived,
    briefError,
    plan,
    previewHtml,
    previewMarkdown,
    readyCount,
    load,
    setAuthor,
    exportFile,
    printPdf,
    generateBrief,
    copyBrief,
    togglePlatform,
    setEntry,
  };
}
