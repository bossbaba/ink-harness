<script setup lang="ts">
import { NSelect } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { SETTING_RAG_MODEL, settingsService } from "@/services/settingsService";
import type { ProviderConfig } from "@/types";

/**
 * 检索（RAG）的全局设置：选一个 embedding 模型。
 *
 * 用户只需决定一件事——用哪个模型把设定与正文变成向量；
 * 索引内容本身按作品维护（后端 `rag_status` / `rag_reindex`），这里只存模型标识。
 */
const props = defineProps<{
  providers: ProviderConfig[];
}>();

const current = ref("");
const saving = ref(false);
const error = ref("");

/** 选项来自已启用 Provider 下已勾选的模型，值和后端约定一致：`providerId:modelId`。 */
const options = computed(() =>
  props.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        label: `${provider.name} · ${model.id}`,
        value: `${provider.id}:${model.id}`,
      })),
    ),
);

/**
 * 存下来的模型可能已被删除或 Provider 被停用，此时后端解析会直接报错。
 * 这里提前提示用户重选，避免到写作时才看到「模型已不可用」。
 */
const unavailable = computed(
  () => current.value !== "" && !options.value.some((item) => item.value === current.value),
);

onMounted(async () => {
  current.value = await settingsService.getString(SETTING_RAG_MODEL);
});

async function handleChange(value: string | null): Promise<void> {
  current.value = value ?? "";
  saving.value = true;
  error.value = "";
  try {
    await settingsService.setString(SETTING_RAG_MODEL, current.value);
  } catch (err) {
    error.value = `保存失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    saving.value = false;
  }
}
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
        :value="current || null"
        :options="options"
        :disabled="saving"
        clearable
        placeholder="未选择（按模型名自动识别）"
        @update:value="handleChange"
      />
    </div>

    <p v-if="error" class="rag__error">{{ error }}</p>
    <p v-else-if="options.length === 0" class="rag__hint">
      还没有可选的模型：请先在上面添加并启用 Provider，再勾选一个 embedding 模型
      （如 nomic-embed-text、bge-m3）。
    </p>
    <p v-else-if="unavailable" class="rag__hint rag__hint--warn">
      已选的模型 {{ current }} 当前不可用（可能已删除或 Provider 被停用），请重新选择。
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
