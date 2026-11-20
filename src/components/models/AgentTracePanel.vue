<script setup lang="ts">
import { NTag } from "naive-ui";
import { computed, ref } from "vue";
import AppEmpty from "@/components/common/AppEmpty.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import type { AgentOutcomeStats, AgentSession, AgentStepRecord, ProviderConfig } from "@/types";

/**
 * Agent 运行轨迹面板：只读展示会话列表与每轮「工具→观察」记录。
 *
 * 放在全局统计页，用于回放 Agent 行为、发现空转与异常调用；
 * 数据来自后端会话表，面板本身不发请求，由父级 composable 注入。
 */
const props = defineProps<{
  sessions: AgentSession[];
  steps: AgentStepRecord[];
  /** 循环停止原因聚合；为 null 表示统计接口失败，成功率标签不显示。 */
  outcomes: AgentOutcomeStats | null;
  /** Provider 列表，按 costPer1kTokens 把步骤 tokens 折算成钱。 */
  providers: ProviderConfig[];
  loading: boolean;
  /** 空状态的行动按钮文案；不传则只显示说明。 */
  actionLabel?: string;
}>();

/** 空状态按钮点击，由父级页面决定跳去哪（组件本身不做路由）。 */
const emit = defineEmits<{ action: [] }>();

const selectedSession = ref("");

/** 按会话分组的步骤，按选中会话过滤；未选中时展示全部。 */
const visibleSteps = computed(() =>
  props.steps.filter((step) => !selectedSession.value || step.sessionId === selectedSession.value),
);

/** 会话标题：按 id 查，找不到就显示 id 前缀。 */
function sessionTitle(sessionId: string): string {
  return props.sessions.find((item) => item.id === sessionId)?.title ?? sessionId.slice(0, 8);
}

/** 把轨迹 JSON 文本转成可读字符串数组，解析失败时原样展示。 */
function readableList(raw: string, field: string): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (item && typeof item === "object" && field in item) {
          return String((item as Record<string, unknown>)[field]);
        }
        return JSON.stringify(item);
      });
    }
  } catch {
    return [raw];
  }
  return [];
}

/** 一轮里调用了哪些工具。 */
function toolNames(step: AgentStepRecord): string[] {
  return readableList(step.toolCalls, "name");
}

/** 一轮里各工具的观察摘要。 */
function observations(step: AgentStepRecord): string[] {
  return readableList(step.observations, "content");
}

/**
 * 按各模型当时单价折算步骤成本。
 * 单价是配置项，改价不回头改历史，所以只做展示估算；老记录没有模型或单价缺失时跳过。
 */
function estimateStepsCost(steps: AgentStepRecord[]): number {
  let cost = 0;
  for (const step of steps) {
    if (!step.model || !step.tokens) continue;
    const separator = step.model.indexOf(":");
    if (separator < 0) continue;
    const rate = props.providers
      .find((provider) => provider.id === step.model.slice(0, separator))
      ?.models.find((model) => model.id === step.model.slice(separator + 1))?.costPer1kTokens;
    if (!rate) continue;
    cost += (rate * step.tokens) / 1000;
  }
  return cost;
}

/**
 * 轨迹聚合：会话数、轮次、调用次数、token 合计、平均延迟、成功率与成本。
 * tokens/延迟为 0 的老记录显示「—」，避免把「没记账」当成「零成本」。
 */
const summary = computed(() => {
  const steps = props.steps;
  const calls = steps.reduce((sum, step) => sum + toolNames(step).length, 0);
  const tokens = steps.reduce((sum, step) => sum + (step.tokens || 0), 0);
  const latency = steps.reduce((sum, step) => sum + (step.latencyMs || 0), 0);
  // Loop 在空转终止时留下「有调用、无观察」的轮次，这是最常见的异常信号，单独计数告警。
  const idle = steps.filter(
    (step) => toolNames(step).length > 0 && observations(step).length === 0,
  ).length;
  const outcomes = props.outcomes;
  const successRate =
    outcomes && outcomes.runs > 0 ? Math.round((outcomes.succeeded / outcomes.runs) * 100) : null;
  return {
    sessions: props.sessions.length,
    rounds: steps.length,
    calls,
    tokens,
    avgLatency: steps.length ? Math.round(latency / steps.length) : 0,
    idle,
    successRate,
    succeeded: outcomes?.succeeded ?? 0,
    runs: outcomes?.runs ?? 0,
    cost: estimateStepsCost(steps),
  };
});

/** 成功率标签的语义色：八成以上算健康，过半算可用，再低就该警惕。 */
function successTagType(rate: number): "success" | "info" | "warning" {
  if (rate >= 80) return "success";
  if (rate >= 50) return "info";
  return "warning";
}
</script>

<template>
  <section class="trace">
    <header class="trace__head">
      <h2 class="trace__title">Agent 运行轨迹</h2>
      <span class="trace__hint">共 {{ sessions.length }} 个会话 · {{ steps.length }} 轮记录</span>
    </header>

    <LoadingState v-if="loading" class="trace__hint" variant="inline" text="正在读取…" />
    <AppEmpty
      v-else-if="steps.length === 0"
      class="trace__empty"
      icon="ideation"
      title="还没有运行记录"
      description="在写作台打开「Agent 模式」提问后，这里会回放每轮的工具调用与观察。"
      :action-label="actionLabel"
      @action="emit('action')"
    />

    <template v-else>
      <div class="trace__summary">
        <NTag size="small" :bordered="false">{{ summary.sessions }} 个会话</NTag>
        <NTag size="small" :bordered="false"
          >{{ summary.rounds }} 轮 · {{ summary.calls }} 次调用</NTag
        >
        <NTag size="small" :bordered="false">tokens {{ summary.tokens || "—" }}</NTag>
        <NTag size="small" :bordered="false">平均 {{ summary.avgLatency || "—" }} ms</NTag>
        <NTag
          v-if="summary.successRate !== null"
          size="small"
          :bordered="false"
          :type="successTagType(summary.successRate)"
        >
          成功率 {{ summary.successRate }}%（{{ summary.succeeded }}/{{ summary.runs }}）
        </NTag>
        <NTag v-if="summary.cost > 0" size="small" :bordered="false">
          ≈ ¥{{ summary.cost.toFixed(2) }}
        </NTag>
        <NTag v-if="summary.idle" size="small" :bordered="false" type="warning">
          空转告警：{{ summary.idle }} 轮未执行
        </NTag>
      </div>

      <div class="trace__filter">
        <button
          type="button"
          class="trace__chip"
          :class="{ 'trace__chip--active': !selectedSession }"
          @click="selectedSession = ''"
        >
          全部
        </button>
        <button
          type="button"
          v-for="session in sessions"
          :key="session.id"
          class="trace__chip"
          :class="{ 'trace__chip--active': selectedSession === session.id }"
          @click="selectedSession = session.id"
        >
          {{ session.title }}
        </button>
      </div>

      <div v-for="step in visibleSteps" :key="step.id" class="trace__step">
        <div class="trace__step-head">
          <NTag size="small" :bordered="false" type="info">第 {{ step.iteration }} 轮</NTag>
          <span class="trace__session">{{ sessionTitle(step.sessionId) }}</span>
          <span class="trace__meta">
            <template v-if="step.model">{{ step.model }} · </template>{{ step.tokens }} tokens ·
            {{ step.latencyMs }} ms
          </span>
        </div>
        <p v-if="toolNames(step).length" class="trace__line">
          工具：{{ toolNames(step).join("、") }}
        </p>
        <p
          v-for="(text, index) in observations(step)"
          :key="index"
          class="trace__line trace__line--obs"
        >
          → {{ text }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.trace {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  &__hint {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__empty {
    padding: t.$space-4 0;
  }

  &__summary {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  &__filter {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  &__chip {
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
    background: var(--bg-sunken, #{t.$paper-sunken});
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-sm;
    cursor: pointer;

    &--active {
      color: var(--accent, #{t.$accent});
      border-color: var(--accent, #{t.$accent});
    }
  }

  &__step {
    display: flex;
    flex-direction: column;
    gap: t.$space-1;
    padding: t.$space-3;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-md;
    min-width: 0;
  }

  &__step-head {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__session {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__meta {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__line {
    margin: 0;
    font-size: 12px;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;

    &--obs {
      color: var(--text-soft, #{t.$ink-soft});
    }
  }
}
</style>
