<script setup lang="ts">
/**
 * 统一指标卡：标签 + 数值 + 附属内容 + 操作区。
 * 数值用默认插槽承载 Tag、单位等，footer 插槽承载操作链接；emphasis 用于强调主指标。
 */
withDefaults(
  defineProps<{
    /** 指标名称，如「作品数」「Ollama 服务」。 */
    label: string;
    /** 主数值，简单指标直接传；复杂内容走默认插槽。 */
    value?: string | number;
    /** 强调态：主指标用主色衬底与强调色数值，与普通指标区分层级。 */
    emphasis?: boolean;
  }>(),
  { value: "", emphasis: false },
);
</script>

<template>
  <div class="stat-card" :class="{ 'stat-card--emphasis': emphasis }">
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
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__label {
    margin: 0;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
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
      font-size: 20px;
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

  // 主指标：淡主色衬底 + 主色数值，让一组卡片里先看最重要的那个。
  &--emphasis {
    border-color: var(--accent-soft);
    background:
      linear-gradient(135deg, var(--accent-soft), transparent 72%),
      var(--bg-surface);

    .stat-card__value strong {
      color: var(--accent);
    }
  }
}
</style>
