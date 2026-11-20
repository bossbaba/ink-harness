<script setup lang="ts">
import { NButton, NInput, NModal, NSpace } from "naive-ui";
import type { SceneDraft } from "@/types";

// 场景弹窗：POV/地点/时间是场景卡的三个关键要素，也是 AI 续写的最小上下文。
const props = defineProps<{
  isNew: boolean;
  busy: boolean;
  error: string;
}>();

const emit = defineEmits<(e: "save") => void>();

const show = defineModel<boolean>("show", { required: true });
const draft = defineModel<SceneDraft>("draft", { required: true });

function close(): void {
  show.value = false;
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="props.isNew ? '新增场景' : '编辑场景'"
    :style="{ width: '560px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
  >
    <div class="form">
      <label class="field">
        <span class="field__label">场景标题</span>
        <NInput
          v-model:value="draft.title"
          placeholder="例如：破庙相遇"
          size="small"
          @keydown.enter.prevent="emit('save')"
        />
      </label>
      <div class="form__row">
        <label class="field">
          <span class="field__label">POV 视角</span>
          <NInput v-model:value="draft.pov" placeholder="跟随谁的视角" size="small" />
        </label>
        <label class="field">
          <span class="field__label">地点</span>
          <NInput v-model:value="draft.location" placeholder="发生在哪里" size="small" />
        </label>
        <label class="field">
          <span class="field__label">时间</span>
          <NInput v-model:value="draft.timeMark" placeholder="例如：第三日清晨" size="small" />
        </label>
      </div>
      <label class="field">
        <span class="field__label">场景摘要</span>
        <NInput
          v-model:value="draft.summary"
          type="textarea"
          :rows="3"
          placeholder="这一场发生的关键事件、人物目标与转折"
        />
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
          {{ props.isNew ? "创建场景" : "保存修改" }}
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
  container-type: inline-size;

  &__row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: t.$space-3;

    @container (max-width: 520px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;

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
