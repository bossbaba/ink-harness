<script setup lang="ts">
import { NEmpty, NTag } from "naive-ui";
import { computed, onMounted } from "vue";
import LoadingState from "@/components/common/LoadingState.vue";
import PageHeader from "@/components/common/PageHeader.vue";
import StatCard from "@/components/common/StatCard.vue";
import AgentTracePanel from "@/components/models/AgentTracePanel.vue";
import CostDashboardPanel from "@/components/models/CostDashboardPanel.vue";
import { useGlobalStats } from "@/composables/useGlobalStats";
import {
  CHAPTER_STATUS_ORDER,
  ELEMENT_KIND_LABEL,
  PROJECT_STATUS_ORDER,
  type StatCountItem,
} from "@/types";
import { onReactivated } from "@/utils/lifecycle";

/**
 * 全局统计（一级路由 /stats）：汇总所有作品的作品数、字数、设定规模与 token 成本。
 * 只读页，不做任何写入；成本看板复用模型管理页的组件，避免两套口径。
 */
const {
  loading,
  stats,
  usage,
  providers,
  budget,
  cost,
  error,
  agentSessions,
  agentSteps,
  agentOutcomes,
  load,
  updateBudget,
} = useGlobalStats();

const totalWorks = computed(() => stats.value?.projects ?? 0);

/**
 * 按给定顺序补全 0 值档位，让状态分布看起来稳定。
 * 顺序表外的 key 是后端新增、前端还没起名的状态，合并成一行「其他」计数，
 * 避免把英文状态值直接摆到界面上。
 */
function withOrder(items: StatCountItem[], order: Array<{ key: string; label: string }>) {
  const map = new Map(items.map((item) => [item.key, item.count]));
  const rows = order.map((item) => ({ label: item.label, count: map.get(item.key) ?? 0 }));
  const known = new Set(order.map((item) => item.key));
  const unknownCount = items
    .filter((item) => !known.has(item.key))
    .reduce((sum, item) => sum + item.count, 0);
  if (unknownCount > 0) rows.push({ label: "其他", count: unknownCount });
  return rows;
}

const projectStatusRows = computed(() =>
  withOrder(stats.value?.projectsByStatus ?? [], PROJECT_STATUS_ORDER),
);
const chapterStatusRows = computed(() =>
  withOrder(stats.value?.chaptersByStatus ?? [], CHAPTER_STATUS_ORDER),
);
const elementKindRows = computed(() =>
  (stats.value?.elementsByKind ?? [])
    .map((item) => ({ label: ELEMENT_KIND_LABEL[item.key] ?? "其他", count: item.count }))
    .sort((a, b) => b.count - a.count),
);

onMounted(() => void load());
onReactivated(() => void load());
</script>

<template>
  <div class="stats">
    <PageHeader
      class="stats__header"
      eyebrow="全局视角"
      title="创作统计"
      subtitle="汇总本机全部作品，数据只用于了解进度，不上传。"
    />

    <p v-if="error" class="stats__error">{{ error }}</p>

    <section class="stats__card">
      <h2 class="stats__section">作品与正文</h2>
      <LoadingState v-if="loading && !stats" variant="inline" text="正在统计…" />
      <template v-else-if="stats">
        <div class="stats__metrics">
          <StatCard label="作品数" :value="stats.projects" emphasis />
          <StatCard label="章节数" :value="stats.chapters" />
          <StatCard label="总字数" :value="stats.totalWords.toLocaleString()" />
          <StatCard label="设定条目" :value="stats.storyElements" />
          <StatCard label="场景 / 伏笔" :value="`${stats.scenes} / ${stats.foreshadows}`" />
        </div>

        <NEmpty
          v-if="totalWorks === 0"
          class="stats__empty"
          size="small"
          description="还没有作品。先到工作台新建一部作品，统计会随创作自动更新。"
        />
        <div v-else class="stats__columns">
          <div class="stats__group">
            <h3 class="stats__group-title">作品阶段</h3>
            <p v-for="row in projectStatusRows" :key="row.label" class="stats__row">
              <span>{{ row.label }}</span>
              <NTag size="small" :bordered="false">{{ row.count }}</NTag>
            </p>
          </div>
          <div class="stats__group">
            <h3 class="stats__group-title">章节状态</h3>
            <p v-for="row in chapterStatusRows" :key="row.label" class="stats__row">
              <span>{{ row.label }}</span>
              <NTag size="small" :bordered="false">{{ row.count }}</NTag>
            </p>
          </div>
          <div class="stats__group">
            <h3 class="stats__group-title">设定类型</h3>
            <NEmpty
              v-if="elementKindRows.length === 0"
              class="stats__group-empty"
              size="tiny"
              :show-icon="false"
              description="暂无设定条目"
            />
            <p v-for="row in elementKindRows" :key="row.label" class="stats__row">
              <span>{{ row.label }}</span>
              <NTag size="small" :bordered="false">{{ row.count }}</NTag>
            </p>
          </div>
        </div>
      </template>
    </section>

    <section class="stats__card">
      <CostDashboardPanel
        :stats="usage"
        :providers="providers"
        :cost="cost"
        :budget="budget"
        :loading="loading"
        @refresh="load"
        @update:budget="(value: number) => void updateBudget(value)"
      />
    </section>

    <section class="stats__card">
      <AgentTracePanel
        :sessions="agentSessions"
        :steps="agentSteps"
        :outcomes="agentOutcomes"
        :providers="providers"
        :loading="loading"
      />
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.stats {
  container-type: inline-size;
  max-width: 1000px;
  margin: 0 auto;
  padding: t.$space-6;

  &__header {
    margin-bottom: t.$space-5;
  }

  &__error {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  &__card {
    @include m.card-surface(var(--bg-surface));
    padding: t.$space-4;
    margin-bottom: t.$space-4;
  }

  &__section {
    margin: 0 0 t.$space-4;
    font-size: 14px;
    font-weight: 600;
  }

  &__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: t.$space-3;
    margin-bottom: t.$space-4;
  }

  &__columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: t.$space-5;
  }

  &__group-title {
    margin: 0 0 t.$space-2;
    font-size: 13px;
    font-weight: 600;
  }

  &__group-empty,
  &__row {
    margin: 0 0 t.$space-2;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-3;
  }

  &__empty {
    padding: t.$space-5;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-lg;
    text-align: center;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
