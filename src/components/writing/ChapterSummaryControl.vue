<script setup lang="ts">
import { MacButton } from "@macvue/core";
import ChapterSummaryDialog from "@/components/writing/ChapterSummaryDialog.vue";
import { useWritingSummaryPanel } from "@/composables/useWritingSummaryPanel";
import type { Chapter, Project } from "@/types";
import { documentToPlainText, EMPTY_DOCUMENT_TEXT } from "@/utils/tiptap";

/**
 * 写作台里的摘要入口：一个按钮 + 一个弹窗，状态全在自己内部。
 * 页面只负责把当前作品/章节/正文传进来，并在摘要写回后同步章节列表。
 */
const props = defineProps<{
  project: Project | null;
  chapter: Chapter | null;
  /** 当前正文的 TipTap JSON，组件内自己转纯文本，页面不必重复拼。 */
  content: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  persisted: [value: string];
}>();

const {
  show,
  budget,
  auto,
  open,
  updateBudget,
  updateAuto,
  summary,
  meta,
  generating,
  saving,
  received,
  error,
  staleChars,
  isStale,
  regenerate,
  persist,
} = useWritingSummaryPanel({
  project: () => props.project,
  chapter: () => props.chapter,
  text: () => {
    const text = documentToPlainText(props.content);
    return text === EMPTY_DOCUMENT_TEXT ? "" : text;
  },
  onPersisted: (value) => emit("persisted", value),
});
</script>

<template>
  <MacButton size="regular" :disabled="disabled" @click="open">
    {{ isStale ? "摘要待更新" : "章节摘要" }}
  </MacButton>

  <ChapterSummaryDialog
    v-model:show="show"
    :summary="summary"
    :meta="meta"
    :generating="generating"
    :saving="saving"
    :received="received"
    :error="error"
    :stale-chars="staleChars"
    :is-stale="isStale"
    :budget="budget"
    :auto="auto"
    @regenerate="regenerate"
    @save="persist"
    @update:budget="updateBudget"
    @update:auto="updateAuto"
  />
</template>
