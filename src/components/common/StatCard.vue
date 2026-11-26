<script setup lang="ts">
/**
 * 统一指标卡：标签 + 数值 + 附属内容 + 操作区。
 * 数值用默认插槽承载 Tag、单位等，footer 插槽承载操作链接；emphasis 只改变数值颜色。
 * 设计稿给统计页和工作台状态区两套不同字号，用 variant 区分，避免调用方各写一遍样式。
 */
withDefaults(
  defineProps<{
    /** 指标名称，如「作品数」「Ollama 服务」。 */
    label: string;
    /** 主数值，简单指标直接传；复杂内容走默认插槽。 */
    value?: string | number;
    /** 强调态：主指标数值用品牌绿，卡面保持纸色。 */
    emphasis?: boolean;
    /** metric=统计页 28px 数字；status=工作台状态区 16px 衬线短句。 */
    variant?: "metric" | "status";
  }>(),
  { value: "", emphasis: false, variant: "metric" },
);
</script>

<template>
  <div class="stat-card" :class="[`stat-card--${variant}`, { 'stat-card--emphasis': emphasis }]">
    <p class="stat-card__label">{{ label }}</p>
    <div class="stat-card__value">
      <strong>{{ value }}</strong>
      <slot />
    </div>
    <div v-if="$slots.footer" class="stat-card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;
@use "@/styles/mixins" as m;

.stat-card {
  min-width: 0;
  @include m.card-surface(var(--bg-surface));

  &__label {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint);
  }

  &__value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
    margin-top: t.$space-2;

    strong {
      @include m.ellipsis;
      font-weight: 600;
      line-height: 1.25;
      color: var(--text-primary);
    }
  }

  &__footer {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-1;
    margin-top: t.$space-2;
  }

  // 设计稿 3:348：统计指标卡 94px 高、16px 内边距、28px 数字。
  &--metric {
    min-height: 94px;
    padding: t.$space-4;

    .stat-card__value strong {
      font-size: 1.75rem;
    }
  }

  // 设计稿 3:285：工作台状态卡 148px 高、20px 内边距、16px 衬线短句。
  &--status {
    min-height: 148px;
    padding: 20px;

    .stat-card__value strong {
      font-family: var(--font-serif, #{t.$font-serif});
      font-size: 16px;
    }
  }

  // 强调态只改数值颜色：设计稿的统计卡面统一纸色，不叠渐变。
  &--emphasis .stat-card__value strong {
    color: var(--accent);
  }
}
</style>
