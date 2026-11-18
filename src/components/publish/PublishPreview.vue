<script setup lang="ts">
import { NButton } from "naive-ui";
import { ref } from "vue";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import type { SegmentOption } from "@/components/common/segmentedControl";
import { PUBLISH_TEMPLATE_HINT, PUBLISH_TEMPLATE_LABEL, type PublishTemplate } from "@/types";

/** 排版预览：同一份正文按三种模板渲染，作者先看清版式再决定导出格式。 */
defineProps<{
  template: PublishTemplate;
  html: string;
  markdown: string;
  readyCount: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:template": [value: PublishTemplate];
  copy: [];
}>();

const source = ref<"html" | "markdown">("html");
const templates: PublishTemplate[] = ["web", "ebook", "print"];
const templateOptions: SegmentOption[] = templates.map((item) => ({
  label: PUBLISH_TEMPLATE_LABEL[item],
  value: item,
}));
const sourceOptions: SegmentOption[] = [
  { label: "版式", value: "html" },
  { label: "Markdown", value: "markdown" },
];
</script>

<template>
  <section class="preview">
    <div class="preview__bar">
      <SegmentedControl
        size="small"
        :options="templateOptions"
        :model-value="template"
        @update:model-value="(value: string) => emit('update:template', value as PublishTemplate)"
      />
      <span class="preview__hint">{{ PUBLISH_TEMPLATE_HINT[template] }}</span>
      <span class="preview__spacer" />
      <SegmentedControl
        size="small"
        :options="sourceOptions"
        :model-value="source"
        @update:model-value="(value: string) => (source = value as 'html' | 'markdown')"
      />
      <NButton size="small" :disabled="!markdown" @click="emit('copy')">复制 Markdown</NButton>
    </div>

    <p class="preview__status">
      {{ loading ? "正在读取正文…" : `已有正文 ${readyCount} 章，空章在导出里保留占位。` }}
    </p>

    <div class="preview__paper">
      <iframe v-if="source === 'html'" class="preview__frame" :srcdoc="html" title="排版预览" />
      <pre v-else class="preview__raw">{{ markdown }}</pre>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.preview {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));
  min-width: 0;

  &__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-3;
    min-width: 0;
  }

  &__hint {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__spacer {
    flex: 1;
  }

  &__status {
    margin: t.$space-3 0 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__paper {
    margin-top: t.$space-3;
    overflow: hidden;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-md;
    background: var(--bg-app);
    min-width: 0;
  }

  &__frame {
    display: block;
    width: 100%;
    height: 620px;
    border: 0;
    background: var(--bg-surface);
  }

  &__raw {
    max-height: 620px;
    margin: 0;
    overflow: auto;
    padding: t.$space-4;
    font-size: 12px;
    line-height: 1.8;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-soft, #{t.$ink-soft});
    @include m.thin-scrollbar;
  }
}
</style>
