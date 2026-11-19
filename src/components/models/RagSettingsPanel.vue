<script setup lang="ts">
import { NSelect } from "naive-ui";

/**
 * 检索（RAG）的全局设置展示：选一个 embedding 模型。
 *
 * 用户只需决定用哪个模型把设定与正文变成向量；索引内容本身按作品维护
 * （后端 rag_status / rag_reindex）。所有状态与设置读写由 useRagSettings 提供，
 * 本组件只收 props、向上 emit 选择变化，不调用任何 service。
 */
const props = defineProps<{
  /** 当前选中的模型标识 `providerId:modelId`，空串表示未选。 */
  current: string;
  /** 可选的 embedding 模型列表。 */
  options: Array<{ label: string; value: string }>;
  /** 正在保存设置。 */
  saving: boolean;
  /** 已选模型当前不可用（被删或 Provider 停用）。 */
  unavailable: boolean;
  /** 保存失败的错误文案，空串表示无错误。 */
  error: string;
}>();

const emit = defineEmits<(e: "change", value: string | null) => void>();
</script>

<template>
  <section class="rag">
    <h2 class="rag__title">检索（RAG）</h2>
    <p class="rag__hint">
      检索会先用这个模型把设定与正文都转成向量，写作时按问题取最相关的几段作为参考资料。
      不选也可以：名字里带 embed / bge / gte / e5 / nomic 的模型会被自动采用。
    </p>

    <div class="rag__row">
      <span class="rag__label">检索模型</span>
      <NSelect
        class="rag__select"
        size="small"
        :value="props.current || null"
        :options="props.options"
        :disabled="props.saving"
        clearable
        placeholder="未选择（按模型名自动识别）"
        @update:value="(value: string | null) => emit('change', value)"
      />
    </div>

    <p v-if="props.error" class="rag__error">{{ props.error }}</p>
    <p v-else-if="props.options.length === 0" class="rag__hint">
      还没有可选的模型：请先在上面添加并启用 Provider，再勾选一个 embedding 模型
      （如 nomic-embed-text、bge-m3）。
    </p>
    <p v-else-if="props.unavailable" class="rag__hint rag__hint--warn">
      已选的模型 {{ props.current }} 当前不可用（可能已删除或 Provider 被停用），请重新选择。
    </p>
    <p class="rag__hint">
      换模型后向量维度可能变化，旧索引会失效，需要到写作台的 AI 对话面板点一次「更新索引」。
    </p>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.rag {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__hint {
    margin: t.$space-2 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    margin: t.$space-2 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  // 已选模型失效属于「要处理但不致命」，用警示色区别于普通说明文字。
  &__hint--warn {
    color: var(--warning, #{t.$warning});
  }

  &__row {
    display: flex;
    align-items: center;
    gap: t.$space-3;
    margin: t.$space-3 0;
    min-width: 0;
  }

  &__label {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__select {
    max-width: 360px;
    min-width: 0;
  }
}
</style>
