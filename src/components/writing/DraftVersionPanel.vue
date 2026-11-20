<script setup lang="ts">
import { NButton, NEmpty, NModal, NPopconfirm } from "naive-ui";
import { computed } from "vue";
import LoadingState from "@/components/common/LoadingState.vue";
import type { DraftVersion, DraftVersionBrief } from "@/types";
import { modalStyle } from "@/utils/modal";
import { formatCount, formatDateTime } from "@/utils/text";
import { documentToPlainText } from "@/utils/tiptap";

/**
 * 版本快照面板：列历史版本、留新快照、预览与恢复。
 * 恢复是不可逆的写操作，统一走 NPopconfirm 二次确认。
 */
const props = defineProps<{
  versions: DraftVersionBrief[];
  loading: boolean;
  /** 保存快照进行中。 */
  snapshotBusy: boolean;
  /** 恢复版本进行中。 */
  restoreBusy: boolean;
  /** 读取预览正文进行中。 */
  previewBusy: boolean;
  preview: DraftVersion | null;
}>();

const emit = defineEmits<{
  (event: "snapshot"): void;
  (event: "preview", versionId: string): void;
  (event: "restore", versionId: string): void;
  (event: "close-preview"): void;
}>();

/** 预览正文：把 TipTap JSON 提纯后再显示，避免在弹窗里再跑一遍编辑器。 */
const previewText = computed(() =>
  props.preview ? documentToPlainText(props.preview.content) : "",
);
</script>

<template>
  <aside class="versions">
    <div class="versions__head">
      <span class="versions__title">版本快照</span>
      <NButton
        size="tiny"
        quaternary
        :loading="props.snapshotBusy"
        :disabled="props.restoreBusy"
        @click="emit('snapshot')"
      >
        保存快照
      </NButton>
    </div>

    <p class="versions__hint">自动保存会在字数大幅变化时留版；想固定一个节点时点「保存快照」。</p>

    <LoadingState v-if="loading" variant="inline" text="正在载入版本…" />
    <NEmpty
      v-else-if="versions.length === 0"
      class="versions__empty"
      size="small"
      :show-icon="false"
      description="还没有历史版本，写下第一段并保存后会出现。"
    />
    <ul v-else class="versions__list">
      <li v-for="item in versions" :key="item.id" class="versions__item">
        <div class="versions__meta">
          <span class="versions__version">第 {{ item.version }} 版</span>
          <span class="versions__time">{{ formatDateTime(item.createdAt) }}</span>
        </div>
        <div class="versions__actions">
          <span class="versions__words">{{ formatCount(item.wordCount) }} 字</span>
          <NButton
            size="tiny"
            quaternary
            :loading="props.previewBusy"
            @click="emit('preview', item.id)"
          >
            预览
          </NButton>
          <NPopconfirm @positive-click="emit('restore', item.id)">
            <template #trigger>
              <NButton
                size="tiny"
                quaternary
                type="error"
                :loading="props.restoreBusy"
                :disabled="props.snapshotBusy"
              >
                恢复
              </NButton>
            </template>
            恢复后当前正文会被替换（当前内容会先存为一版快照）。
          </NPopconfirm>
        </div>
      </li>
    </ul>

    <NModal
      :show="Boolean(preview)"
      preset="card"
      class="version-preview"
      :title="preview ? `第 ${preview.version} 版 · ${formatCount(preview.wordCount)} 字` : ''"
      :style="modalStyle(720)"
      @update:show="emit('close-preview')"
    >
      <pre class="version-preview__text">{{ previewText }}</pre>
      <template #footer>
        <div class="version-preview__footer">
          <NButton size="small" @click="emit('close-preview')">关闭</NButton>
          <NButton
            v-if="preview"
            size="small"
            type="primary"
            :loading="props.restoreBusy"
            :disabled="props.snapshotBusy"
            @click="emit('restore', preview.id)"
          >
            恢复到这一版
          </NButton>
        </div>
      </template>
    </NModal>
  </aside>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.versions {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  padding: t.$space-4;
  overflow: auto;
  border-left: 1px solid var(--divider, #{t.$divider});
  background: var(--bg-surface);
  @include m.thin-scrollbar;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__hint,
  &__empty {
    margin: t.$space-2 0 t.$space-3;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint);
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__item {
    padding: t.$space-2 t.$space-3;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-md;
    background: var(--bg-app);
  }

  &__meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__version {
    font-size: 12px;
    color: var(--text-primary);
  }

  &__time {
    font-size: 11px;
    color: var(--text-faint);
  }

  &__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
    margin-top: 4px;
  }

  &__words {
    font-size: 11px;
    color: var(--text-soft);
  }
}

.version-preview {
  &__text {
    max-height: 52vh;
    margin: 0;
    overflow: auto;
    font-family: var(--font-serif, #{t.$font-serif});
    font-size: 13px;
    line-height: 1.9;
    white-space: pre-wrap;
    color: var(--text-primary);
    @include m.thin-scrollbar;
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: t.$space-2;
  }
}
</style>
