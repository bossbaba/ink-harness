<script setup lang="ts">
import { NButton, NInput, NInputNumber, NModal, NSwitch } from "naive-ui";
import { ref, watch } from "vue";
import type { SummaryMeta } from "@/services/summaryService";

/**
 * 章节摘要弹窗：既能看/改摘要，也能调上下文预算与自动更新开关。
 * 摘要即「长期记忆」，后续 AI 请求靠它记住这一章发生过什么。
 */
const props = defineProps<{
  show: boolean;
  summary: string;
  meta: SummaryMeta | null;
  generating: boolean;
  saving: boolean;
  received: number;
  error: string;
  staleChars: number;
  isStale: boolean;
  budget: number;
  auto: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  "update:budget": [value: number];
  "update:auto": [value: boolean];
  regenerate: [];
  save: [value: string];
}>();

const draft = ref("");

// 打开弹窗或摘要被重新生成后刷新草稿，避免把上一次未保存的编辑带进来。
watch(
  () => [props.show, props.summary] as const,
  ([open, value]) => {
    if (open) draft.value = value;
  },
  { immediate: true },
);

const dirty = () => draft.value !== props.summary;
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="章节摘要 · 长期记忆"
    class="summary-dialog"
    :style="{ width: '640px', maxWidth: 'calc(100vw - 48px)' }"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="summary">
      <p class="summary__hint">
        摘要会在续写、改写、AI 对话
        和审稿时作为「本章梗概」注入模型。正文比摘要多出较多字时，记得更新。
      </p>

      <p v-if="isStale" class="summary__stale">
        正文比摘要多了 {{ staleChars }} 字，建议重新生成，免得 AI 不知道最近发生了什么。
      </p>
      <p v-else-if="meta" class="summary__meta">
        基线 {{ meta.wordCount }} 字 · 更新于
        {{ meta.generatedAt.slice(0, 16).replace("T", " ") || "未知" }}
      </p>

      <label class="summary__field">
        <span>摘要正文（可手动修改）</span>
        <NInput
          v-model:value="draft"
          type="textarea"
          size="small"
          :autosize="{ minRows: 4, maxRows: 10 }"
          placeholder="这一章发生了什么、人物与伏笔有什么变化…"
        />
      </label>

      <p v-if="generating" class="summary__status">模型正在归纳… 已收到 {{ received }} 字</p>
      <p v-if="error" class="summary__error">{{ error }}</p>

      <div class="summary__actions">
        <NButton
          size="small"
          type="primary"
          :disabled="generating || saving"
          @click="emit('regenerate')"
        >
          {{ generating ? "生成中…" : "重新生成" }}
        </NButton>
        <NButton
          size="small"
          :disabled="generating || saving || !dirty()"
          @click="emit('save', draft)"
        >
          {{ saving ? "保存中…" : "保存修改" }}
        </NButton>
      </div>

      <div class="summary__settings">
        <h3 class="summary__settings-title">注入额度</h3>
        <label class="summary__setting">
          <span>作品上下文字符预算（默认 6000，超出部分截断）</span>
          <NInputNumber
            :value="budget"
            :min="1000"
            :step="1000"
            size="small"
            @update:value="(value: number | null) => emit('update:budget', value ?? 6000)"
          />
        </label>
        <label class="summary__setting summary__setting--switch">
          <span>正文累积 500 字后自动刷新摘要（关闭时只提醒，不调用模型）</span>
          <NSwitch
            :value="auto"
            size="small"
            @update:value="(value: boolean) => emit('update:auto', value)"
          />
        </label>
      </div>
    </div>
  </NModal>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.summary {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;

  &__hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__stale,
  &__meta,
  &__status,
  &__error {
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__stale {
    color: var(--warning, #{t.$warning});
  }

  &__error {
    color: var(--error, #{t.$error});
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    min-width: 0;

    > span {
      font-size: 11px;
      color: var(--text-faint, #{t.$ink-faint});
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  &__settings {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    margin-top: t.$space-2;
    padding-top: t.$space-3;
    border-top: 1px solid var(--divider, #{t.$divider});
  }

  &__settings-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  &__setting {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-3;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});

    &--switch {
      min-height: 28px;
    }
  }
}
</style>
