<script setup lang="ts">
/**
 * 统一页面标题区：眉标 + 一级标题 + 副标题 + 操作区。
 * 只负责排版与插槽分发，不承接任何业务逻辑；操作按钮由使用方通过 actions 插槽放入。
 * 左侧主色竖条是全局统一的视觉锚点，避免每个页面各写一套标题样式。
 */
withDefaults(
  defineProps<{
    /** 标题上方的小字，标明页面所属作用域，如「系统设置」「全局视角」。 */
    eyebrow?: string;
    /** 页面标题（一级标题，统一 1.5rem 衬线）。 */
    title: string;
    /** 标题下方的一句话说明，说清页面职责与数据范围。 */
    subtitle?: string;
  }>(),
  { eyebrow: "", subtitle: "" },
);
</script>

<template>
  <header class="page-header">
    <p v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</p>
    <div class="page-header__row">
      <div class="page-header__text">
        <h1 class="page-header__title serif">{{ title }}</h1>
        <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page-header__actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;

.page-header {
  position: relative;
  min-width: 0;
  padding-left: t.$space-4;

  // 竖条用主色标记「当前页」，比纯文字标题更有识别度。
  &::before {
    content: "";
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 0;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  &__eyebrow {
    margin: 0 0 t.$space-2;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--accent);
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__text {
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: 0.02em;
    color: var(--text-primary);
  }

  &__subtitle {
    margin: t.$space-2 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft);
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: t.$space-2;
  }
}
</style>
