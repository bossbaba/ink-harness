<script setup lang="ts">
import { NButton, NInput, NModal, NSelect, NSpace } from "naive-ui";
import { computed } from "vue";
import { actOptions, CHAPTER_STATUS_OPTIONS, type ChapterDraft, DEFAULT_ACT_COUNT } from "@/types";

// 章节弹窗：只编辑草稿，提交动作 emit save 交给页面/composable 发请求。
const props = withDefaults(
  defineProps<{
    isNew: boolean;
    busy: boolean;
    error: string;
    /** 所属幕的可选范围：默认三幕，大纲/写作台新增幕后会一起变大。 */
    actCount?: number;
  }>(),
  { actCount: DEFAULT_ACT_COUNT },
);

const emit = defineEmits<(e: "save") => void>();

const actSelectOptions = computed(() => actOptions(props.actCount));

const show = defineModel<boolean>("show", { required: true });
const draft = defineModel<ChapterDraft>("draft", { required: true });

function close(): void {
  show.value = false;
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="props.isNew ? '新增章节' : '编辑章节'"
    :style="{ width: '520px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
  >
    <div class="form">
      <label class="field">
        <span class="field__label">所属幕</span>
        <NSelect v-model:value="draft.act" :options="actSelectOptions" size="small" />
      </label>
      <label class="field">
        <span class="field__label">章节标题</span>
        <NInput
          v-model:value="draft.title"
          placeholder="例如：雨夜破庙"
          size="small"
          @keydown.enter.prevent="emit('save')"
        />
      </label>
      <label class="field">
        <span class="field__label">本章梗概</span>
        <NInput
          v-model:value="draft.summary"
          type="textarea"
          :rows="3"
          placeholder="这一章发生什么、推进了什么冲突"
        />
      </label>
      <label class="field">
        <span class="field__label">状态</span>
        <NSelect v-model:value="draft.status" :options="CHAPTER_STATUS_OPTIONS" size="small" />
      </label>
      <p v-if="props.error" class="error">{{ props.error }}</p>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" :disabled="props.busy" @click="close">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="props.busy"
          :disabled="!draft.title.trim()"
          @click="emit('save')"
        >
          {{ props.isNew ? "创建章节" : "保存修改" }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.form {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;

  &__label {
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--error, #{t.$error});
}
</style>
