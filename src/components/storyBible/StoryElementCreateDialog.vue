<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NInput, NModal, NSelect, NSpace } from "naive-ui";
import { STORY_KIND_OPTIONS, type StoryElementKind } from "@/types";

defineProps<{ busy: boolean; error: string }>();

const emit = defineEmits<(e: "create") => void>();

// 表单字段全部用 defineModel 交给 useStoryBible 管理，弹窗本身不持有数据。
// 提交动作也只 emit create，新建请求由父组件发出，成功后由父组件关闭弹窗。
const show = defineModel<boolean>("show", { required: true });
const kind = defineModel<StoryElementKind>("kind", { required: true });
const name = defineModel<string>("name", { required: true });
const summary = defineModel<string>("summary", { required: true });

function close(): void {
  show.value = false;
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    title="新建设定"
    :style="{ width: '520px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
  >
    <div class="form">
      <label class="field">
        <span class="field__label">类型</span>
        <NSelect v-model:value="kind" :options="STORY_KIND_OPTIONS" />
      </label>
      <label class="field">
        <span class="field__label">名称</span>
        <NInput
          v-model:value="name"
          placeholder="人物、地点或术语名称"
          @keydown.enter.prevent="emit('create')"
        />
      </label>
      <label class="field">
        <span class="field__label">一句话摘要</span>
        <NInput
          v-model:value="summary"
          type="textarea"
          :rows="3"
          placeholder="这条设定在故事中的作用"
        />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #footer>
      <NSpace justify="end">
        <MacButton size="regular" :disabled="busy" @click="close">取消</MacButton>
        <MacButton
          size="regular"
          variant="prominent"
          :disabled="busy || !name.trim()"
          @click="emit('create')"
        >
          {{ busy ? "创建中…" : "创建设定" }}
        </MacButton>
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
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--error, #{t.$error});
}
</style>
