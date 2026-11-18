<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NInput, NSelect } from "naive-ui";
import { computed } from "vue";
import {
  EXPORT_FORMAT_LABEL,
  type ExportFormat,
  type ExportResult,
  PUBLISH_TEMPLATE_LABEL,
  type PublishTemplate,
} from "@/types";

/** 导出面板：格式与署名在这选，文件写到哪由系统对话框决定。 */
const props = defineProps<{
  format: ExportFormat;
  template: PublishTemplate;
  author: string;
  exporting: boolean;
  notice: string;
  lastExport: ExportResult | null;
}>();

const emit = defineEmits<{
  "update:format": [value: ExportFormat];
  "update:author": [value: string];
  export: [];
  print: [];
}>();

const options = (Object.keys(EXPORT_FORMAT_LABEL) as ExportFormat[]).map((value) => ({
  label: EXPORT_FORMAT_LABEL[value],
  value,
}));

/** PDF 不走 write_export_file：中文 PDF 要嵌字体，交给系统打印更稳。 */
const isPdf = computed(() => props.format === "pdf");
</script>

<template>
  <section class="export">
    <div class="export__row">
      <label class="export__field">
        <span>导出格式</span>
        <NSelect
          :value="format"
          :options="options"
          size="small"
          class="export__select"
          @update:value="(value: ExportFormat) => emit('update:format', value)"
        />
      </label>
      <label class="export__field export__field--grow">
        <span>署名（只写进导出文件）</span>
        <NInput
          :value="author"
          size="small"
          placeholder="笔名，可留空"
          @update:value="(value: string) => emit('update:author', value)"
        />
      </label>
    </div>

    <p class="export__hint">
      当前排版：{{ PUBLISH_TEMPLATE_LABEL[template] }}。{{
        isPdf
          ? "点击后在系统打印对话框里选「另存为 PDF」。"
          : "点击后选保存位置，文件在本机生成，不上传。EPUB / DOCX 均可直接打开。"
      }}
    </p>

    <div class="export__actions">
      <MacButton
        v-if="isPdf"
        size="regular"
        variant="prominent"
        :disabled="exporting"
        @click="emit('print')"
      >
        打印 / 另存为 PDF
      </MacButton>
      <MacButton
        v-else
        size="regular"
        variant="prominent"
        :disabled="exporting"
        @click="emit('export')"
      >
        {{ exporting ? "导出中…" : `导出 ${EXPORT_FORMAT_LABEL[format]}` }}
      </MacButton>
    </div>

    <p v-if="notice" class="export__notice">{{ notice }}</p>
    <p v-if="lastExport" class="export__detail">
      上次导出 {{ lastExport.size }} 字节 · {{ lastExport.path }}
    </p>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.export {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));
  min-width: 0;

  &__row {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-4;
    min-width: 0;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    width: 200px;
    min-width: 0;

    &--grow {
      flex: 1;
      width: auto;
    }

    > span {
      font-size: 11px;
      color: var(--text-faint, #{t.$ink-faint});
    }
  }

  &__select {
    width: 100%;
  }

  &__hint {
    margin: t.$space-4 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__actions {
    margin-top: t.$space-4;
  }

  &__notice,
  &__detail {
    margin: t.$space-3 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
    word-break: break-all;
  }
}

@container (max-width: 620px) {
  .export__field,
  .export__field--grow {
    width: 100%;
  }
}
</style>
