<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NInput, NTag } from "naive-ui";
import type { PublicationBrief } from "@/types";

/** 发布物料面板：模型产出只是草稿，四个字段都能直接改。 */
const props = defineProps<{
  brief: PublicationBrief | null;
  raw: string;
  generating: boolean;
  received: number;
  error: string;
}>();

const emit = defineEmits<{
  generate: [];
  copy: [];
  "update:field": [field: keyof PublicationBrief, value: string | string[]];
}>();

const fields: Array<{ key: keyof PublicationBrief; label: string; rows: number }> = [
  { key: "blurb", label: "作品简介", rows: 4 },
  { key: "coverBrief", label: "封面需求简报", rows: 3 },
  { key: "queryLetter", label: "投稿信", rows: 5 },
];

function asText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("，") : (value ?? "");
}
</script>

<template>
  <section class="brief">
    <div class="brief__bar">
      <p class="brief__hint">简介、标签、封面简报和投稿信一次生成，改成你要的措辞后再复制。</p>
      <span class="brief__spacer" />
      <MacButton size="small" :disabled="!brief" @click="emit('copy')">复制物料</MacButton>
      <MacButton size="small" variant="prominent" :disabled="generating" @click="emit('generate')">
        {{ generating ? "生成中…" : brief ? "重新生成" : "生成物料" }}
      </MacButton>
    </div>

    <p v-if="generating" class="brief__status">模型正在写物料… 已收到 {{ received }} 字</p>
    <p v-if="error" class="brief__error">{{ error }}</p>

    <div v-if="brief" class="brief__fields">
      <label v-for="field in fields" :key="field.key" class="brief__field">
        <span>{{ field.label }}</span>
        <NInput
          :value="asText(brief[field.key])"
          type="textarea"
          size="small"
          :autosize="{ minRows: field.rows, maxRows: field.rows + 6 }"
          @update:value="(value: string) => emit('update:field', field.key, value)"
        />
      </label>

      <div class="brief__field">
        <span>标签（用逗号分隔）</span>
        <NInput
          :value="brief.tags.join('，')"
          size="small"
          placeholder="悬疑，推理，都市"
          @update:value="
            (value: string) =>
              emit(
                'update:field',
                'tags',
                value
                  .split(/[,，]/u)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              )
          "
        />
        <div class="brief__tags">
          <NTag v-for="tag in brief.tags" :key="tag" size="small" :bordered="false">
            {{ tag }}
          </NTag>
        </div>
      </div>
    </div>

    <p v-else-if="!generating" class="brief__empty">还没有发布物料，点「生成物料」开始。</p>

    <pre v-if="raw && !brief" class="brief__raw">{{ raw }}</pre>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.brief {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));
  min-width: 0;

  &__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__hint {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__spacer {
    flex: 1;
  }

  &__status,
  &__error {
    margin: t.$space-3 0 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    color: var(--error, #{t.$error});
  }

  &__fields {
    display: flex;
    flex-direction: column;
    gap: t.$space-4;
    margin-top: t.$space-4;
    min-width: 0;
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

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  &__empty {
    margin: t.$space-4 0 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__raw {
    max-height: 240px;
    margin: t.$space-3 0 0;
    overflow: auto;
    padding: t.$space-3;
    border-radius: t.$radius-md;
    background: var(--bg-app);
    font-size: 11px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-soft, #{t.$ink-soft});
    @include m.thin-scrollbar;
  }
}
</style>
