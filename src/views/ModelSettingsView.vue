<script setup lang="ts">
import { NButton, NSelect, NSpace, NSwitch, NTag } from "naive-ui";
import { computed } from "vue";
import PageHeader from "@/components/common/PageHeader.vue";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import type { SegmentOption } from "@/components/common/segmentedControl";
import ProviderCard from "@/components/models/ProviderCard.vue";
import ProviderEditDialog from "@/components/models/ProviderEditDialog.vue";
import RagSettingsPanel from "@/components/models/RagSettingsPanel.vue";
import { useModelSettings } from "@/composables/useModelSettings";
import type { RouteStrategy } from "@/types";

// 模型管理页：Provider 分组展示、连接测试、模型同步与编辑弹窗。
const {
  providers,
  ollama,
  ollamaStarting,
  ollamaRefreshing,
  ollamaError,
  stopOllamaOnExit,
  routeStrategy,
  defaultModel,
  savingSetting,
  loading,
  busy,
  testingId,
  syncingId,
  removingId,
  error,
  probeMessages,
  totalModels,
  dialogShow,
  dialogIsNew,
  draft,
  apiKey,
  clearKey,
  probing,
  probeError,
  discovered,
  refreshOllama,
  startOllama,
  setStopOllamaOnExit,
  setRouteStrategy,
  setDefaultModel,
  openCreate,
  openEdit,
  probeDraft,
  toggleModel,
  setContextWindow,
  setSupportsTools,
  save,
  toggleEnabled,
  remove,
  testProvider,
  syncModels,
  rag,
} = useModelSettings();

const groups = computed(() =>
  [
    { key: "local", label: "本地模型", items: providers.value.filter((p) => p.source === "local") },
    {
      key: "remote",
      label: "云端模型",
      items: providers.value.filter((p) => p.source === "remote"),
    },
  ].filter((group) => group.items.length > 0),
);

// 任务偏好固定，策略由作者在下面选；两者一起决定每个任务实际用哪个模型。
const ROUTES = [
  { task: "构思 / 摘要", hint: "优先本地、低成本模型" },
  { task: "续写 / 改写 / 扩写", hint: "优选中大上下文窗口" },
  { task: "润色 / 审校", hint: "优先强指令遵循与推理" },
];

const ollamaRunning = computed(() => ollama.value?.running ?? false);

/**
 * 默认模型候选：已启用 Provider 下勾选的模型，值和后端一致用 `providerId:modelId`。
 * 与 RagSettingsPanel 的选项口径保持一致。
 */
const defaultModelOptions = computed(() =>
  providers.value
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        label: `${provider.name} · ${model.displayName || model.id}`,
        value: `${provider.id}:${model.id}`,
      })),
    ),
);

/** 选中的默认模型若已被删除或 Provider 停用，要提示重选，否则会静默回落到策略选模型。 */
const defaultModelUnavailable = computed(
  () =>
    defaultModel.value !== "" &&
    !defaultModelOptions.value.some((item) => item.value === defaultModel.value),
);

/** 全局策略只有三档，改为分段控件后与系统设置里的外观/路由切换保持一致。 */
const routeOptions: SegmentOption[] = [
  { label: "质量优先", value: "quality" },
  { label: "成本优先", value: "cost" },
  { label: "隐私优先", value: "privacy" },
];
</script>

<template>
  <div class="model-settings">
    <PageHeader
      eyebrow="系统设置"
      title="模型管理"
      subtitle="配置本地与云端模型。API Key 存系统钥匙串，请求由本地 Rust 代理发出，作品设为「仅本地」时不会走云端。"
    >
      <template #actions>
        <NSpace>
          <NButton
            size="small"
            :loading="ollamaRefreshing"
            :disabled="loading && !ollamaRefreshing"
            @click="refreshOllama"
          >
            重新检测 Ollama
          </NButton>
          <NButton size="small" type="primary" :disabled="loading" @click="openCreate">
            新增 Provider
          </NButton>
        </NSpace>
      </template>
    </PageHeader>

    <p v-if="error" class="model-settings__error">{{ error }}</p>

    <div class="stats">
      <span class="stats__item">Provider <strong>{{ providers.length }}</strong></span>
      <span class="stats__item">已启用模型 <strong>{{ totalModels }}</strong></span>
      <span class="stats__item">
        Ollama <strong>{{ ollamaRunning ? "运行中" : "未运行" }}</strong>
      </span>
    </div>

    <section class="panel">
      <header class="panel__head">
        <h2 class="panel__title">本地 Ollama</h2>
        <div class="panel__status">
          <NTag size="small" :bordered="false" :type="ollamaRunning ? 'success' : 'default'">
            {{ ollamaRunning ? "运行中" : "未运行" }}
          </NTag>
          <NButton
            v-if="!ollamaRunning"
            size="small"
            type="primary"
            :loading="ollamaStarting"
            @click="startOllama"
          >
            启动本地模型
          </NButton>
        </div>
      </header>
      <p v-if="ollamaError" class="panel__error">{{ ollamaError }}</p>
      <div class="panel__setting">
        <div>
          <p class="panel__setting-label">退出应用时停止本地模型</p>
          <p class="panel__setting-hint">
            只停由本应用拉起的实例；你手动启动、或别的工具正在用的 Ollama 不会被动。
          </p>
        </div>
        <NSwitch
          size="small"
          :value="stopOllamaOnExit"
          :disabled="savingSetting"
          @update:value="setStopOllamaOnExit"
        />
      </div>
      <p v-if="!ollamaRunning" class="panel__hint">
        本地模型未启动。点「启动本地模型」会直接拉起 Ollama（桌面版 App 或 `ollama
        serve`），无需打开终端；
        若尚未安装，请先到 ollama.com 下载桌面版。
      </p>
      <template v-else>
        <div v-if="ollama?.models.length" class="ollama-list">
          <NTag v-for="model in ollama.models" :key="model" size="tiny" :bordered="false">
            {{ model }}
          </NTag>
        </div>
        <p v-else class="panel__hint">
          服务在运行，但还没有下载模型，可先执行 `ollama pull llama3.2`。
        </p>
      </template>
    </section>

    <section v-for="group in groups" :key="group.key" class="group">
      <h2 class="group__title">
        {{ group.label }} <span class="group__count">{{ group.items.length }}</span>
      </h2>
      <div class="provider-grid">
        <ProviderCard
          v-for="provider in group.items"
          :key="provider.id"
          :provider="provider"
          :busy="busy"
          :testing="testingId === provider.id"
          :syncing="syncingId === provider.id"
          :removing="removingId === provider.id"
          :test-message="probeMessages[provider.id] ?? ''"
          @edit="openEdit(provider)"
          @remove="remove(provider)"
          @toggle="(enabled: boolean) => toggleEnabled(provider, enabled)"
          @test="testProvider(provider)"
          @sync="syncModels(provider)"
        />
      </div>
    </section>

    <section class="panel routing">
      <h2 class="panel__title">任务路由</h2>
      <p class="panel__hint">
        可以先指定一个「默认模型」固定所有 AI
        动作；不指定时，路由再按任务需求与下面的策略自动挑模型。
        作品隐私设为「仅本地」时，无论哪种设置都只用本地模型。
      </p>
      <div class="routing__default">
        <div>
          <p class="routing__strategy-label">默认模型</p>
          <p class="routing__strategy-hint">
            选定后，构思、写作、审稿、摘要、出版等所有 AI
            动作都固定使用这个模型，界面顶栏也会显示当前所用模型。
            清除后恢复按策略自动选择。
          </p>
        </div>
        <NSelect
          class="routing__default-select"
          size="small"
          :value="defaultModel || null"
          :options="defaultModelOptions"
          :disabled="savingSetting"
          clearable
          placeholder="自动选择（按策略）"
          @update:value="(value: string | null) => setDefaultModel(value ?? '')"
        />
      </div>
      <p v-if="defaultModelUnavailable" class="routing__warn">
        已选的默认模型 {{ defaultModel }} 当前不可用（可能已删除或 Provider
        被停用），已暂时回落到自动选择，请重新指定。
      </p>
      <div class="routing__strategy">
        <div>
          <p class="routing__strategy-label">全局策略</p>
          <p class="routing__strategy-hint">
            质量优先用大上下文模型，成本优先用便宜/本地模型，隐私优先只挑本地。改完立即对所有 AI
            动作生效。
          </p>
        </div>
        <SegmentedControl
          size="small"
          :options="routeOptions.map((option) => ({ ...option, disabled: savingSetting }))"
          :model-value="routeStrategy"
          @update:model-value="(value: string) => setRouteStrategy(value as RouteStrategy)"
        />
      </div>
      <div class="routing__list">
        <span v-for="item in ROUTES" :key="item.task" class="routing__item">
          <strong>{{ item.task }}</strong>
          {{ item.hint }}
        </span>
      </div>
    </section>

    <!-- 检索模型选择：这里只定用哪个模型做向量化，索引状态与重建按作品进行 -->
    <RagSettingsPanel
      :current="rag.current.value"
      :options="rag.options.value"
      :saving="rag.saving.value"
      :unavailable="rag.unavailable.value"
      :error="rag.error.value"
      @change="(value: string | null) => void rag.setModel(value)"
    />

    <ProviderEditDialog
      v-model:show="dialogShow"
      v-model:draft="draft"
      v-model:api-key="apiKey"
      v-model:clear-key="clearKey"
      :is-new="dialogIsNew"
      :busy="busy"
      :probing="probing"
      :probe-error="probeError"
      :discovered="discovered"
      @probe="probeDraft"
      @save="save"
      @toggle-model="toggleModel"
      @context-window="setContextWindow"
      @supports-tools="setSupportsTools"
    />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;
@use "../styles/model-routing";

.model-settings {
  max-width: 1200px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  // 页面级错误提示：标题区已抽成 PageHeader，这里只保留异常文案样式。
  &__error {
    margin: t.$space-3 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: t.$space-3;
  margin-top: t.$space-4;

  &__item {
    padding: 4px 10px;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: 999px;
    background: var(--bg-surface);
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});

    strong {
      margin-left: 2px;
      color: var(--text-primary, #{t.$ink});
    }
  }
}

.panel {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__status {
    display: flex;
    align-items: center;
    gap: t.$space-2;
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

  // 设置项：左侧说明、右侧开关，与上面的状态信息用分隔线隔开。
  &__setting {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
    margin-top: t.$space-3;
    padding-top: t.$space-3;
    border-top: 1px solid var(--divider, #{t.$divider});
  }

  &__setting-label {
    margin: 0;
    font-size: 12px;
    color: var(--text-primary);
  }

  &__setting-hint {
    margin: 2px 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.ollama-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: t.$space-2;
}

.group {
  margin-top: t.$space-5;

  &__title {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    margin: 0 0 t.$space-3;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__count {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: t.$space-4;
  min-width: 0;
}

// 路由面板样式抽到 ../styles/_model-routing.scss，避免本文件超过 500 行。

@container (max-width: 620px) {
  .model-settings__header {
    flex-direction: column;
  }
}
</style>
