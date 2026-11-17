<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NCheckbox, NInput, NInputNumber, NModal, NSelect, NSpace, NTag } from "naive-ui";
import { computed } from "vue";
import { DEFAULT_CONTEXT_WINDOW, type ProviderConfig } from "@/types";

// Provider 编辑弹窗：字段全部双向绑定到 composable 的草稿，
// 探测与保存通过 emit 交给父组件，弹窗自身不发请求。
const props = defineProps<{
  isNew: boolean;
  busy: boolean;
  probing: boolean;
  probeError: string;
  /** 最近一次探测返回的模型 id。 */
  discovered: string[];
}>();

const emit = defineEmits<{
  (e: "probe"): void;
  (e: "save"): void;
  (e: "toggle-model", id: string, checked: boolean): void;
  (e: "context-window", id: string, value: number | null): void;
}>();

const show = defineModel<boolean>("show", { required: true });
const draft = defineModel<ProviderConfig>("draft", { required: true });
const apiKey = defineModel<string>("apiKey", { required: true });
const clearKey = defineModel<boolean>("clearKey", { required: true });

const sourceOptions = [
  { label: "本地模型（Ollama 等）", value: "local" },
  { label: "云端 OpenAI 兼容接口", value: "remote" },
];

/** 探测结果 + 已保存模型的并集：已启用但这次没探测到的模型也要能取消。 */
const modelRows = computed(() => {
  const ids = new Set<string>();
  for (const id of props.discovered) ids.add(id);
  for (const model of draft.value.models) ids.add(model.id);
  return Array.from(ids);
});

function isModelChecked(id: string): boolean {
  return draft.value.models.some((model) => model.id === id);
}

function contextWindowOf(id: string): number {
  return (
    draft.value.models.find((model) => model.id === id)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  );
}

function close(): void {
  show.value = false;
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="props.isNew ? '新增 Provider' : '编辑 Provider'"
    :style="{ width: '640px', maxWidth: 'calc(100vw - 48px)' }"
    :bordered="false"
  >
    <div class="form">
      <div class="form__row">
        <label class="field">
          <span class="field__label">名称</span>
          <NInput
            v-model:value="draft.name"
            placeholder="例如：DeepSeek / 本地 Ollama"
            size="small"
          />
        </label>
        <label class="field">
          <span class="field__label">来源</span>
          <NSelect v-model:value="draft.source" :options="sourceOptions" size="small" />
        </label>
      </div>

      <label class="field">
        <span class="field__label">服务地址</span>
        <NInput
          v-model:value="draft.baseUrl"
          placeholder="http://localhost:11434/v1 或 https://api.deepseek.com/v1"
          size="small"
        />
      </label>
      <p class="hint">
        本地 Ollama 填 http://localhost:11434/v1；云端填兼容 OpenAI 协议的 base
        URL，保存时会自动去掉末尾斜杠。
      </p>

      <label class="field">
        <span class="field__label">API Key（可选，保存到系统钥匙串）</span>
        <NInput
          v-model:value="apiKey"
          type="password"
          show-password-on="click"
          placeholder="本地模型可留空"
          size="small"
        />
      </label>
      <div v-if="draft.apiKeyRef" class="key-state">
        <NTag size="tiny" :bordered="false" type="success">已保存密钥</NTag>
        <NCheckbox v-model:checked="clearKey">清除已保存密钥</NCheckbox>
      </div>

      <div class="probe">
        <MacButton size="regular" :disabled="props.probing || props.busy" @click="emit('probe')">
          {{ props.probing ? "探测中…" : "测试连接并拉取模型" }}
        </MacButton>
        <span class="hint">不会保存配置，只验证地址与密钥是否可用。</span>
      </div>
      <p v-if="props.probeError" class="error">{{ props.probeError }}</p>

      <section class="models">
        <header class="models__head">
          <h4 class="models__title">模型（已启用 {{ draft.models.length }}）</h4>
          <span class="hint">勾选后填写上下文窗口，任务路由会据此选模型</span>
        </header>
        <p v-if="modelRows.length === 0" class="models__empty">
          还没有模型列表，填写地址后点击「测试连接并拉取模型」。
        </p>
        <div v-for="id in modelRows" :key="id" class="model-row">
          <NCheckbox
            :checked="isModelChecked(id)"
            @update:checked="(checked: boolean) => emit('toggle-model', id, checked)"
          />
          <span class="model-row__id" :title="id">{{ id }}</span>
          <NInputNumber
            class="model-row__window"
            size="tiny"
            :value="contextWindowOf(id)"
            :min="1024"
            :step="1024"
            :disabled="!isModelChecked(id)"
            @update:value="(value: number | null) => emit('context-window', id, value)"
          >
            <template #suffix>tokens</template>
          </NInputNumber>
        </div>
      </section>
    </div>

    <template #footer>
      <NSpace justify="end">
        <MacButton size="regular" :disabled="props.busy" @click="close">取消</MacButton>
        <MacButton
          size="regular"
          variant="prominent"
          :disabled="props.busy || !draft.name.trim()"
          @click="emit('save')"
        >
          {{ props.busy ? "保存中…" : "保存" }}
        </MacButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.form {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  container-type: inline-size;

  &__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 200px;
    gap: t.$space-3;

    @container (max-width: 560px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;

  &__label {
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-faint, #{t.$ink-faint});
}

.key-state {
  display: flex;
  align-items: center;
  gap: t.$space-3;
}

.probe {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: t.$space-3;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--error, #{t.$error});
}

.models {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding-top: t.$space-3;
  border-top: 1px solid var(--divider, #{t.$divider});

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  &__empty {
    margin: 0;
    padding: t.$space-3 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.model-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 150px;
  align-items: center;
  gap: t.$space-2;
  min-width: 0;

  &__id {
    font-size: 12px;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__window {
    width: 100%;
  }
}
</style>
