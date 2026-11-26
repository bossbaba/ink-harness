<script setup lang="ts">
import { type DataTableColumns, NDataTable } from "naive-ui";
import { h } from "vue";
import AppEmpty from "@/components/common/AppEmpty.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import type { AgentEvalHistoryRow } from "@/types";

/**
 * 评测历史表格：按设计稿的「时间 / 模型·角色 / 通过率 / 变化 / 开销」五列陈列。
 *
 * 列渲染函数只负责把派生数据摆成对应单元格，不在这里重新算通过率或趋势；
 * 行数据由 useAgentEval 统一生成，避免结果区与历史区口径不一致。
 */
const props = defineProps<{
  rows: AgentEvalHistoryRow[];
  loading: boolean;
}>();

/** 时间戳只显示到分钟：历史看的是顺序与趋势，秒级精度没有意义。 */
function shortTime(value: string): string {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

/** 差值文案：上涨用 ↑、下降用 ↓，颜色由语义 class 决定。 */
function deltaText(delta: number | null): string {
  if (delta === null) return "无历史可比";
  if (delta === 0) return "与上次持平";
  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}% 较上次`;
}

const columns: DataTableColumns<AgentEvalHistoryRow> = [
  {
    title: "时间",
    key: "createdAt",
    width: 150,
    render: (row) => h("span", { class: "hist-table__time" }, shortTime(row.createdAt)),
  },
  {
    title: "模型 / 角色",
    key: "model",
    render: (row) =>
      h("span", { class: "hist-table__identity" }, [
        h("span", { class: "hist-table__model" }, row.model || "未记录模型"),
        h("span", { class: "hist-table__sep" }, " · "),
        h("span", null, row.roleName || "默认角色"),
      ]),
  },
  {
    title: "通过率",
    key: "rate",
    width: 110,
    render: (row) =>
      h("span", { class: "hist-table__rate", title: `${row.passed}/${row.total} 通过` }, [
        h("span", { class: "hist-table__track" }, [
          h("span", {
            class: "hist-table__fill",
            style: { width: `${Math.max(0, Math.min(row.rate, 100))}%` },
          }),
        ]),
        h(
          "span",
          {
            class: [
              "hist-table__rate-value",
              row.rate === 0 ? "hist-table__rate-value--zero" : null,
            ],
          },
          `${row.rate}%`,
        ),
      ]),
  },
  {
    title: "变化",
    key: "delta",
    width: 110,
    render: (row) => {
      const kind = row.delta === null || row.delta === 0 ? "flat" : row.delta > 0 ? "up" : "down";
      return h(
        "span",
        { class: `hist-table__delta hist-table__delta--${kind}` },
        deltaText(row.delta),
      );
    },
  },
  {
    title: "开销",
    key: "meta",
    width: 170,
    render: (row) =>
      h(
        "span",
        { class: "hist-table__meta" },
        `${row.rounds} 题 · ${row.tokens || "—"} tokens · ${row.durationMs} ms`,
      ),
  },
];

// 只在首屏无数据时用整块空状态；刷新时保留表格，避免历史行闪一下再出现。
const showEmpty = () => props.rows.length === 0;
</script>

<template>
  <div class="hist-table">
    <LoadingState v-if="loading && showEmpty()" variant="inline" text="正在读取历史…" />
    <AppEmpty
      v-else-if="showEmpty()"
      icon="stats"
      title="还没有评测记录"
      description="选一部作品点「开始评测」，跑完会自动存一条记录，之后换模型可以对比。"
    />
    <NDataTable
      v-else
      :columns="columns"
      :data="rows"
      :pagination="false"
      :bordered="false"
      :single-line="false"
      size="small"
      :row-key="(row: AgentEvalHistoryRow) => row.id"
    />
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.hist-table {
  container-type: inline-size;
  min-width: 0;

  // 表头是 26px 高的浅灰条，圆角 8px；用 thead 裁切才能让底色不冒出圆角。
  :deep(.n-data-table-thead) {
    border-radius: t.$radius-sm;
    overflow: hidden;
  }

  :deep(.n-data-table-th) {
    padding: t.$space-2;
    background: var(--bg-app, #{t.$paper});
    font-size: 10px;
    font-weight: 400;
    color: var(--text-faint, #{t.$ink-faint});
  }

  :deep(.n-data-table-td) {
    padding: t.$space-2;
    font-size: 10px;
    color: var(--text-primary, #{t.$ink});
  }

  &__identity {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 4px;
  }

  &__model {
    min-width: 0;
    @include m.ellipsis;
  }

  &__time {
    color: var(--text-muted, #{t.$ink-muted});
  }

  &__meta {
    font-size: 9px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__sep {
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__rate {
    display: inline-flex;
    align-items: center;
    gap: t.$space-2;
  }

  &__track {
    display: block;
    flex-shrink: 0;
    width: 54px;
    height: 5px;
    border-radius: 3px;
    background: var(--accent-soft, #{t.$accent-soft});
    overflow: hidden;
  }

  &__fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent, #{t.$accent});
  }

  &__rate-value {
    font-size: 10px;
    color: var(--accent, #{t.$accent});

    // 设计稿里 0% 用红字提示，进度条本身仍是浅绿空槽。
    &--zero {
      color: var(--error, #{t.$error});
    }
  }

  &__delta {
    font-size: 10px;

    &--up {
      color: var(--accent, #{t.$accent});
    }

    &--down {
      color: var(--error, #{t.$error});
    }

    &--flat {
      color: var(--text-faint, #{t.$ink-faint});
    }
  }
}
</style>
