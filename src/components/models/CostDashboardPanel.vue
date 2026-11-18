<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NInputNumber, NProgress } from "naive-ui";
import { computed } from "vue";
import { estimateCost } from "@/services/usageService";
import { type ProviderConfig, TASK_KIND_LABEL, type UsageStats } from "@/types";

/** 成本看板：token 是真实采集的，费用按模型配置里的单价估算。 */
const props = defineProps<{
  stats: UsageStats | null;
  providers: ProviderConfig[];
  budget: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  "update:budget": [value: number];
}>();

const cost = computed(() => (props.stats ? estimateCost(props.stats, props.providers) : 0));
const percent = computed(() => {
  if (!props.budget || !props.stats) return 0;
  return Math.min(100, Math.round((props.stats.totalTokens / props.budget) * 100));
});
const taskLabel = (kind: string): string => TASK_KIND_LABEL[kind] ?? kind;
</script>

<template>
  <section class="dashboard">
    <div class="dashboard__bar">
      <div>
        <h2 class="dashboard__title">Token 与成本</h2>
        <p class="dashboard__hint">
          上游返回用量时按任务与模型记录；费用按当前模型单价估算，改价不改写历史。
        </p>
      </div>
      <span class="dashboard__spacer" />
      <label class="dashboard__budget">
        <span>月度预算（token，0 为不设）</span>
        <NInputNumber
          :value="budget"
          :min="0"
          :step="100000"
          size="small"
          class="dashboard__budget-input"
          @update:value="(value: number | null) => emit('update:budget', value ?? 0)"
        />
      </label>
      <MacButton size="small" :disabled="loading" @click="emit('refresh')">
        {{ loading ? "读取中…" : "刷新" }}
      </MacButton>
    </div>

    <p v-if="!stats" class="dashboard__empty">还没有调用记录，用一次 AI 写作或审稿后再刷新。</p>

    <template v-else>
      <div class="dashboard__metrics">
        <div class="metric">
          <span class="metric__label">调用次数</span>
          <strong class="metric__value">{{ stats.calls }}</strong>
        </div>
        <div class="metric">
          <span class="metric__label">总 Token</span>
          <strong class="metric__value">{{ stats.totalTokens.toLocaleString() }}</strong>
        </div>
        <div class="metric">
          <span class="metric__label">输入 / 输出</span>
          <strong class="metric__value metric__value--small">
            {{ stats.promptTokens.toLocaleString() }} /
            {{ stats.completionTokens.toLocaleString() }}
          </strong>
        </div>
        <div class="metric">
          <span class="metric__label">估算费用</span>
          <strong class="metric__value">${{ cost.toFixed(4) }}</strong>
        </div>
      </div>

      <div v-if="budget > 0" class="dashboard__progress">
        <NProgress
          type="line"
          :percentage="percent"
          :height="8"
          :show-indicator="false"
          :color="percent >= 90 ? 'var(--error, #d03050)' : 'var(--accent, #409eff)'"
        />
        <span>{{ stats.totalTokens.toLocaleString() }} / {{ budget.toLocaleString() }} token</span>
      </div>

      <div class="dashboard__columns">
        <div class="dashboard__column">
          <h3 class="dashboard__subtitle">按任务</h3>
          <p v-if="stats.byTask.length === 0" class="dashboard__muted">暂无数据</p>
          <ul v-else class="dashboard__list">
            <li v-for="item in stats.byTask" :key="item.taskKind">
              <span>{{ taskLabel(item.taskKind) }}</span>
              <span class="dashboard__muted">{{ item.calls }} 次</span>
              <strong>{{ item.tokens.toLocaleString() }}</strong>
            </li>
          </ul>
        </div>
        <div class="dashboard__column">
          <h3 class="dashboard__subtitle">按模型</h3>
          <p v-if="stats.byModel.length === 0" class="dashboard__muted">暂无数据</p>
          <ul v-else class="dashboard__list">
            <li v-for="item in stats.byModel" :key="item.model">
              <span class="dashboard__model" :title="item.model">{{ item.model }}</span>
              <span class="dashboard__muted">{{ item.calls }} 次</span>
              <strong>{{ item.tokens.toLocaleString() }}</strong>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.dashboard {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));
  min-width: 0;

  &__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: t.$space-3;
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  &__hint {
    margin: 4px 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__spacer {
    flex: 1;
  }

  &__budget {
    display: flex;
    flex-direction: column;
    gap: t.$space-1;
    width: 180px;

    > span {
      font-size: 11px;
      color: var(--text-faint, #{t.$ink-faint});
    }
  }

  &__budget-input {
    width: 100%;
  }

  &__empty,
  &__muted {
    margin: t.$space-3 0 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: t.$space-3;
    margin-top: t.$space-4;
    min-width: 0;
  }

  &__progress {
    display: flex;
    align-items: center;
    gap: t.$space-3;
    margin-top: t.$space-4;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});

    > :first-child {
      flex: 1;
    }
  }

  &__columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: t.$space-4;
    margin-top: t.$space-4;
    min-width: 0;
  }

  &__column {
    min-width: 0;
  }

  &__subtitle {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin: t.$space-2 0 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: t.$space-2;
      align-items: baseline;
      font-size: 12px;
      min-width: 0;
    }
  }

  &__model {
    @include m.ellipsis;
  }
}

.metric {
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  background: var(--bg-app);
  min-width: 0;

  &__label {
    display: block;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__value {
    display: block;
    margin-top: 4px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);

    &--small {
      font-size: 14px;
    }
  }
}

@container (max-width: 620px) {
  .dashboard__columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .dashboard__budget {
    width: 100%;
  }
}
</style>
