<script setup lang="ts">
/**
 * 统一页面标题区：眉标 + 一级标题 + 副标题 + 操作区。
 * 只负责排版与插槽分发，不承接任何业务逻辑；操作按钮由使用方通过 actions 插槽放入。
 * 对齐 Ardot 设计稿：全局页标题 30px 衬线、眉标 11px 主色、说明 12px 正文灰，
 * 标题不再加左侧竖条——竖条只属于工作台「我的作品」这类区块标题。
 */
withDefaults(
  defineProps<{
    /** 标题上方的小字，标明页面所属作用域，如「系统设置」「全局视角」。 */
    eyebrow?: string;
    /** 页面标题（一级标题，设计稿全局页统一 30px 衬线）。 */
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
  min-width: 0;

  // 设计稿 3:343：眉标用紧凑字距，和 30px 标题保持 8px 呼吸。
  &__eyebrow {
    margin: 0 0 t.$space-2;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
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
    // 设计稿全局页标题 30px（节点 3:345），作品内页另有 26px 档位。
    font-size: 1.875rem;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.02em;
    color: var(--text-primary);
  }

  &__subtitle {
    margin: t.$space-2 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-muted, #{t.$ink-muted});
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: t.$space-2;
  }
}
</style>
