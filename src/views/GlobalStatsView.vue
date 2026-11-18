<script setup lang="ts">
import { NEmpty, NTag } from "naive-ui";
import { computed, onMounted } from "vue";
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
const { loading, stats, usage, providers, budget, error, load, updateBudget } = useGlobalStats();

const totalWorks = computed(() => stats.value?.projects ?? 0);

/** 按给定顺序补全 0 值档位，让状态分布看起来稳定；顺序表外的 key 追加在后面。 */
function withOrder(items: StatCountItem[], order: Array<{ key: string; label: string }>) {
  const map = new Map(items.map((item) => [item.key, item.count]));
  const rows = order.map((item) => ({ label: item.label, count: map.get(item.key) ?? 0 }));
  const known = new Set(order.map((item) => item.key));
  for (const item of items) {
    if (!known.has(item.key)) rows.push({ label: item.key, count: item.count });
  }
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
    .map((item) => ({ label: ELEMENT_KIND_LABEL[item.key] ?? item.key, count: item.count }))
    .sort((a, b) => b.count - a.count),
);

onMounted(() => void load());
onReactivated(() => void load());
</script>

<template>
  <div class="stats">
    <header class="stats__header">
      <h1 class="stats__title serif">创作统计</h1>
      <p class="stats__sub">汇总本机全部作品，数据只用于了解进度，不上传。</p>
    </header>

    <p v-if="error" class="stats__error">{{ error }}</p>

    <section class="stats__card">
      <h2 class="stats__section">作品与正文</h2>
      <p v-if="loading && !stats" class="stats__loading">正在统计…</p>
      <template v-else-if="stats">
        <div class="stats__metrics">
          <div class="metric">
            <span class="metric__label">作品数</span>
            <strong class="metric__value">{{ stats.projects }}</strong>
          </div>
          <div class="metric">
            <span class="metric__label">章节数</span>
            <strong class="metric__value">{{ stats.chapters }}</strong>
          </div>
          <div class="metric">
            <span class="metric__label">总字数</span>
            <strong class="metric__value">{{ stats.totalWords.toLocaleString() }}</strong>
          </div>
          <div class="metric">
            <span class="metric__label">设定条目</span>
            <strong class="metric__value">{{ stats.storyElements }}</strong>
          </div>
          <div class="metric">
            <span class="metric__label">场景 / 伏笔</span>
            <strong class="metric__value metric__value--small">
              {{ stats.scenes }} / {{ stats.foreshadows }}
            </strong>
          </div>
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
        :budget="budget"
        :loading="loading"
        @refresh="load"
        @update:budget="(value: number) => void updateBudget(value)"
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

  &__title {
    margin: 0 0 t.$space-2;
    font-size: 1.5rem;
  }

  &__sub,
  &__loading,
  &__error {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
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

.metric {
  padding: t.$space-3;
  border-radius: t.$radius-md;
  background: var(--bg-sunken, #{t.$paper-sunken});

  &__label {
    display: block;
    margin-bottom: t.$space-2;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__value {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});

    &--small {
      font-size: 15px;
    }
  }
}
</style>
