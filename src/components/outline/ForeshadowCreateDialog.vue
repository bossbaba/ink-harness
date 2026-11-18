<script setup lang="ts">
import { NButton, NInput, NModal, NSelect, NSpace } from "naive-ui";
import { FORESHADOW_STATUS_OPTIONS, type ForeshadowDraft } from "@/types";

// 新增伏笔弹窗：只填标题与「铺设/回收」章节，创建后可在右侧面板继续调整。
const props = defineProps<{
  busy: boolean;
  error: string;
  chapterOptions: Array<{ label: string; value: string }>;
}>();

const emit = defineEmits<(e: "save") => void>();

const show = defineModel<boolean>("show", { required: true });
const draft = defineModel<ForeshadowDraft>("draft", { required: true });

function close(): void {
  show.value = false;
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    title="新增伏笔"
    :style="{ width: '520px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
  >
    <div class="form">
      <label class="field">
        <span class="field__label">伏笔名称</span>
        <NInput
          v-model:value="draft.title"
          placeholder="例如：断剑上的纹样"
          size="small"
          @keydown.enter.prevent="emit('save')"
        />
      </label>
      <label class="field">
        <span class="field__label">铺设章节</span>
        <NSelect
          :value="draft.setupChapterId || null"
          :options="props.chapterOptions"
          size="small"
          clearable
          placeholder="在哪个章节埋下"
          @update:value="(value: string | null) => (draft.setupChapterId = value ?? '')"
        />
      </label>
      <label class="field">
        <span class="field__label">回收章节</span>
        <NSelect
          :value="draft.payoffChapterId || null"
          :options="props.chapterOptions"
          size="small"
          clearable
          placeholder="计划在哪个章节回收"
          @update:value="(value: string | null) => (draft.payoffChapterId = value ?? '')"
        />
      </label>
      <label class="field">
        <span class="field__label">状态</span>
        <NSelect v-model:value="draft.status" :options="FORESHADOW_STATUS_OPTIONS" size="small" />
      </label>
      <p v-if="props.error" class="error">{{ props.error }}</p>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" :disabled="props.busy" @click="close">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="props.busy || !draft.title.trim()"
          @click="emit('save')"
        >
          {{ props.busy ? "保存中…" : "创建伏笔" }}
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
