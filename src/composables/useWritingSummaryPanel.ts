import { onMounted, ref, watch } from "vue";
import { useChapterSummary } from "@/composables/useChapterSummary";
import {
  DEFAULT_CONTEXT_BUDGET,
  getAutoSummary,
  getContextBudget,
  setAutoSummary,
  setContextBudget,
} from "@/services/summaryService";
import type { Chapter, Project } from "@/types";

/**
 * 写作台里的「章节摘要 + 注入预算」面板状态。
 * 把这部分从 ProjectWritingView 抽出来，页面只管挂载组件、同步章节列表。
 */
export function useWritingSummaryPanel(options: {
  project: () => Project | null;
  chapter: () => Chapter | null;
  /** 当前正文纯文本，含未保存改动。 */
  text: () => string;
  /** 摘要写回成功后通知页面同步章节列表。 */
  onPersisted: (value: string) => void;
}) {
  const show = ref(false);
  const budget = ref(DEFAULT_CONTEXT_BUDGET);
  const auto = ref(false);
  let lastWordCount = 0;

  const summary = useChapterSummary({
    project: options.project,
    chapter: options.chapter,
    text: options.text,
    onPersisted: options.onPersisted,
  });

  onMounted(async () => {
    const [savedBudget, savedAuto] = await Promise.all([getContextBudget(), getAutoSummary()]);
    budget.value = savedBudget;
    auto.value = savedAuto;
    lastWordCount = options.chapter()?.wordCount ?? 0;
    // 首次进写作台也要读到摘要基线，否则自动刷新判断会拿到空的 meta。
    void summary.load();
  });

  // 字数增长到阈值就自动刷新摘要；首次载入与手动写回不触发，避免自己唤醒自己。
  watch(
    () => options.chapter()?.wordCount ?? 0,
    (count) => {
      if (count > lastWordCount) {
        lastWordCount = count;
        if (auto.value && summary.shouldAutoUpdate.value) void summary.regenerate();
      } else {
        lastWordCount = count;
      }
    },
  );

  watch(
    () => options.chapter()?.id,
    () => {
      lastWordCount = options.chapter()?.wordCount ?? 0;
      void summary.load();
    },
  );

  function open(): void {
    show.value = true;
    void summary.load();
  }

  async function updateBudget(value: number): Promise<void> {
    const previous = budget.value;
    budget.value = value;
    try {
      await setContextBudget(value);
    } catch (err) {
      budget.value = previous;
      summary.error.value = `保存摘要预算失败：${String(err)}`;
    }
  }

  async function updateAuto(value: boolean): Promise<void> {
    const previous = auto.value;
    auto.value = value;
    try {
      await setAutoSummary(value);
    } catch (err) {
      auto.value = previous;
      summary.error.value = `保存自动摘要开关失败：${String(err)}`;
    }
  }

  return {
    show,
    budget,
    auto,
    open,
    updateBudget,
    updateAuto,
    ...summary,
  };
}
