<script setup lang="ts">
import { NBadge, NButton, NEmpty, NPopconfirm, NSwitch, NTag, NTooltip } from "naive-ui";
import { computed } from "vue";
import type { ProviderConfig } from "@/types";

// Provider 卡片：只展示状态与派发操作，配置修改统一走弹窗或 composable。
const props = defineProps<{
  provider: ProviderConfig;
  busy: boolean;
  /** 本卡片正在测试连接（只让这个按钮转圈）。 */
  testing: boolean;
  /** 本卡片正在同步模型。 */
  syncing: boolean;
  /** 本卡片正在删除。 */
  removing: boolean;
  testMessage: string;
}>();

const emit = defineEmits<{
  (e: "edit"): void;
  (e: "remove"): void;
  (e: "toggle", enabled: boolean): void;
  (e: "test"): void;
  (e: "sync"): void;
}>();

// 模型可能很多，卡片上只展示前 6 个，其余用计数提示，避免把卡片撑高。
const visibleModels = computed(() => props.provider.models.slice(0, 6));
const hiddenCount = computed(() => Math.max(0, props.provider.models.length - 6));
</script>

<template>
  <article class="provider" :class="{ 'provider--off': !props.provider.enabled }">
    <header class="provider__head">
      <div class="provider__identity">
        <!-- 启用状态圆点用 NBadge dot，颜色取语义变量，避免业务组件里写死色值。 -->
        <NBadge dot :color="props.provider.enabled ? 'var(--accent)' : 'var(--text-faint)'" />
        <div class="provider__text">
          <!-- 设计稿 3:507：名称与接口地址同一行，摘要另起一行；本地源不再重复打「本地」标签。 -->
          <p class="provider__line">
            <strong class="provider__name">{{ props.provider.name }}</strong>
            <NTag
              v-if="props.provider.source !== 'local'"
              size="tiny"
              :bordered="false"
              type="info"
            >
              云端
            </NTag>
            <span class="provider__dot">·</span>
            <!-- 接口地址较长会被截断，悬浮用 NTooltip 给出完整地址。 -->
            <NTooltip>
              <template #trigger>
                <span class="provider__url">{{ props.provider.baseUrl }}</span>
              </template>
              {{ props.provider.baseUrl }}
            </NTooltip>
          </p>
          <p class="provider__meta">{{ props.provider.models.length }} 个已启用模型</p>
        </div>
      </div>
      <NSwitch
        size="small"
        :value="props.provider.enabled"
        :disabled="props.busy"
        @update:value="(value: boolean) => emit('toggle', value)"
      />
    </header>

    <div v-if="visibleModels.length" class="provider__models">
      <!-- 设计稿 3:511：已启用模型用浅绿标签，和 Provider 状态圆点保持同一语义色。 -->
      <NTag
        v-for="model in visibleModels"
        :key="model.id"
        size="tiny"
        :bordered="false"
        type="success"
      >
        {{ model.displayName || model.id }}
      </NTag>
      <NTag v-if="hiddenCount" size="tiny" :bordered="false" type="success">
        +{{ hiddenCount }}
      </NTag>
    </div>
    <NEmpty
      v-else
      class="provider__empty"
      size="tiny"
      :show-icon="false"
      description="还没有启用模型，点击「同步模型」或编辑后拉取。"
    />

    <p v-if="props.testMessage" class="provider__probe">{{ props.testMessage }}</p>

    <footer class="provider__actions">
      <NButton
        size="tiny"
        quaternary
        :loading="props.testing"
        :disabled="props.busy && !props.testing"
        @click="emit('test')"
      >
        测试连接
      </NButton>
      <NButton
        v-if="props.provider.source === 'local'"
        size="tiny"
        quaternary
        :loading="props.syncing"
        :disabled="props.busy && !props.syncing"
        @click="emit('sync')"
      >
        同步模型
      </NButton>
      <NButton size="tiny" quaternary :disabled="props.busy" @click="emit('edit')">编辑</NButton>
      <NPopconfirm @positive-click="emit('remove')">
        <template #trigger>
          <NButton
            size="tiny"
            quaternary
            type="error"
            :loading="props.removing"
            :disabled="props.busy && !props.removing"
          >
            删除
          </NButton>
        </template>
        删除该 Provider 及其密钥记录？
      </NPopconfirm>
    </footer>
  </article>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.provider {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &--off {
    opacity: 0.72;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__identity {
    display: flex;
    align-items: flex-start;
    gap: t.$space-2;
    min-width: 0;
  }

  &__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin: 0;
    font-size: 12px;
  }

  &__name {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__dot {
    flex-shrink: 0;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__url {
    min-width: 0;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
    @include m.ellipsis;
  }

  &__meta {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__models {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  &__empty {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__probe {
    margin: 0;
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-1;
    padding-top: t.$space-2;
    border-top: 1px solid var(--divider, #{t.$divider});
  }
}
</style>
