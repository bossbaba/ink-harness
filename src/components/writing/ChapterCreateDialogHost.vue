<script setup lang="ts">
import { ref } from "vue";
import ChapterEditDialog from "@/components/outline/ChapterEditDialog.vue";
import type { Act, Chapter, ChapterDraft, ChapterStatus } from "@/types";

/**
 * 写作台里的「直接建章」弹窗宿主。
 *
 * 复用大纲页的 ChapterEditDialog，但把弹窗状态与保存流程收在这里：
 * 页面只通过 ref.open(act) 打开、通过 created 事件拿到新章 id 后跳转。
 * 建章能力由父级注入，组件不直接调 service，符合 components 只用 props/emit 的约定。
 */
const props = defineProps<{
  actCount: number;
  createChapter: (input: {
    act: Act;
    title: string;
    summary?: string;
    status?: ChapterStatus;
  }) => Promise<Chapter | null>;
  /** 建章失败时父级 composable 记下的错误文案。 */
  getError: () => string;
}>();

const emit = defineEmits<{ created: [chapterId: string] }>();

const show = ref(false);
const busy = ref(false);
const error = ref("");
const draft = ref<ChapterDraft>({ id: "", act: 1, title: "", summary: "", status: "planned" });

function open(act: number): void {
  error.value = "";
  draft.value = { id: "", act, title: "", summary: "", status: "planned" };
  show.value = true;
}

async function save(): Promise<void> {
  const value = draft.value;
  if (!value.title.trim()) {
    error.value = "请输入章节标题";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const chapter = await props.createChapter({
      act: value.act,
      title: value.title,
      summary: value.summary,
      status: value.status,
    });
    if (!chapter) {
      error.value = props.getError() || "创建章节失败，请重试。";
      return;
    }
    show.value = false;
    emit("created", chapter.id);
  } finally {
    busy.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <!-- 建章弹窗与大纲页共用：字段少、就地创建，保存成功后直接跳到新章开始写。 -->
  <ChapterEditDialog
    v-model:show="show"
    v-model:draft="draft"
    :is-new="true"
    :busy="busy"
    :error="error"
    :act-count="actCount"
    @save="save"
  />
</template>
