<script setup lang="ts">
import { NSpin } from "naive-ui";

/**
 * 统一加载占位：页面首屏用 block 虚线框，行内提示用 inline 一行式。
 * 抽组件是为了让「正在载入…」的转圈、字号、间距只有一套定义，
 * 各页面不再各写一份 __loading 样式。
 */
withDefaults(
  defineProps<{
    /** 加载提示文案，按页面语义传入具体在等什么。 */
    text?: string;
    /** block：区块级占位（首屏/空面板）；inline：行内一行提示（局部刷新）。 */
    variant?: "block" | "inline";
  }>(),
  { text: "加载中…", variant: "block" },
);
</script>

<template>
  <div
    class="loading-state"
    :class="variant === 'inline' ? 'loading-state--inline' : 'loading-state--block'"
    role="status"
    aria-live="polite"
  >
    <NSpin size="small" />
    <span class="loading-state__text">{{ text }}</span>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;

.loading-state {
  display: flex;
  align-items: center;
  gap: t.$space-2;
  min-width: 0;
  color: var(--text-faint, #{t.$ink-faint});

  &__text {
    min-width: 0;
  }

  // 区块级：虚线框居中，撑起首屏/空面板的占位高度。
  &--block {
    justify-content: center;
    margin-top: t.$space-6;
    padding: t.$space-8 t.$space-4;
    text-align: center;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-lg;
    font-size: 13px;
  }

  // 行内：跟正文同级的小字提示，不带边框与外边距。
  &--inline {
    font-size: 11px;
    line-height: 1.7;
  }
}
</style>
