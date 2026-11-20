<script setup lang="ts">
import { NButton, NSelect, NTag } from "naive-ui";
import { computed, onMounted } from "vue";
import AppEmpty from "@/components/common/AppEmpty.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import PageHeader from "@/components/common/PageHeader.vue";
import { useAgentEval } from "@/composables/useAgentEval";

/**
 * Agent 评测（一级路由 /agent-eval）：用固定任务集跑当前模型与角色，记录通过率。
 *
 * 用途是回归对比：换模型、改系统提示、加工具之后跑一遍，看通过率与轮次有没有退化。
 * 判定只看工具使用与循环收敛，不做语义打分——那需要另一个模型当裁判，成本与稳定性都不可控。
 */
const {
  projects,
  roles,
  projectId,
  roleId,
  loading,
  running,
  progress,
  error,
  result,
  history,
  historyRows,
  canRun,
  load,
  run,
  cancel,
} = useAgentEval();

const projectOptions = computed(() =>
  projects.value.map((item) => ({ label: item.title, value: item.id })),
);
const roleOptions = computed(() => [
  { label: "默认角色（全部工具）", value: "" },
  ...roles.value.map((role) => ({ label: role.name, value: role.id })),
]);

/** 最近一次结果的通过率，界面顶部用大号数字展示。 */
const lastRate = computed(() => {
  const cases = result.value?.cases.length ?? 0;
  return cases > 0 ? Math.round(((result.value?.passed ?? 0) / cases) * 100) : 0;
});

/** 通过率语义色：八成以上健康，过半可用，再低说明该换模型或改提示词。 */
function rateType(rate: number): "success" | "info" | "warning" {
  if (rate >= 80) return "success";
  if (rate >= 50) return "info";
  return "warning";
}

/** 时间戳只显示到分钟：评测历史看的是顺序与趋势，秒级精度没有意义。 */
function shortTime(value: string): string {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

onMounted(() => void load());
</script>

<template>
  <div class="eval">
    <PageHeader
      eyebrow="全局视角"
      title="Agent 评测"
      subtitle="用一组固定任务跑真实工具调用，换模型或改提示词后对比通过率与轮次。"
    />

    <p v-if="error" class="eval__error">{{ error }}</p>

    <section class="eval__card">
      <h2 class="eval__section">运行配置</h2>
      <div class="eval__form">
        <label class="eval__field">
          <span class="eval__label">评测作品</span>
          <NSelect
            v-model:value="projectId"
            size="small"
            :options="projectOptions"
            placeholder="选择一部作品"
            :disabled="running"
          />
        </label>
        <label class="eval__field">
          <span class="eval__label">角色</span>
          <NSelect v-model:value="roleId" size="small" :options="roleOptions" :disabled="running" />
        </label>
        <div class="eval__actions">
          <NButton v-if="!running" size="small" type="primary" :disabled="!canRun" @click="run">
            开始评测
          </NButton>
          <NButton v-else size="small" @click="cancel">停止</NButton>
        </div>
      </div>
      <p v-if="progress" class="eval__progress">{{ progress }}</p>
      <p class="eval__hint">
        用例覆盖读作品、列设定、读章节、检索与写候选五条链路；每次跑分会写进历史，方便换模型后对比。
      </p>
    </section>

    <section v-if="result" class="eval__card">
      <div class="eval__head">
        <h2 class="eval__section">本次结果</h2>
        <NTag size="small" :bordered="false" :type="rateType(lastRate)">
          通过率 {{ lastRate }}%（{{ result.passed }}/{{ result.cases.length }}）
        </NTag>
        <NTag size="small" :bordered="false">{{ result.rounds }} 轮</NTag>
        <NTag size="small" :bordered="false">tokens {{ result.tokens || "—" }}</NTag>
        <NTag size="small" :bordered="false">{{ result.durationMs }} ms</NTag>
        <NTag v-if="result.model" size="small" :bordered="false">{{ result.model }}</NTag>
      </div>

      <ul class="eval__cases">
        <li
          v-for="item in result.cases"
          :key="item.caseId"
          class="eval__case"
          :class="{ 'eval__case--failed': !item.ok }"
        >
          <div class="eval__case-head">
            <NTag size="small" :bordered="false" :type="item.ok ? 'success' : 'warning'">
              {{ item.ok ? "通过" : "未通过" }}
            </NTag>
            <span class="eval__case-title">{{ item.title }}</span>
            <span class="eval__case-meta"> {{ item.rounds }} 轮 · {{ item.tokens }} tokens </span>
          </div>
          <p v-if="item.reason" class="eval__case-reason">{{ item.reason }}</p>
          <p v-if="item.calls.length" class="eval__case-calls">调用：{{ item.calls.join("、") }}</p>
        </li>
      </ul>
    </section>

    <section class="eval__card">
      <div class="eval__head">
        <h2 class="eval__section">评测历史</h2>
        <NButton size="small" quaternary :loading="loading" @click="load">刷新</NButton>
      </div>

      <LoadingState v-if="loading && history.length === 0" variant="inline" text="正在读取历史…" />
      <AppEmpty
        v-else-if="history.length === 0"
        icon="stats"
        title="还没有评测记录"
        description="选一部作品点「开始评测」，跑完会自动存一条记录，之后换模型可以对比。"
      />

      <ul v-else class="eval__history">
        <li v-for="row in historyRows" :key="row.id" class="eval__history-row">
          <span class="eval__history-time">{{ shortTime(row.createdAt) }}</span>
          <span class="eval__history-model">{{ row.model || "未记录模型" }}</span>
          <span class="eval__history-role">{{ row.roleName || "默认角色" }}</span>
          <NTag size="small" :bordered="false" :type="rateType(row.rate)">
            {{ row.rate }}%（{{ row.passed }}/{{ row.total }}）
          </NTag>
          <span class="eval__history-meta">
            {{ row.rounds }} 轮 · {{ row.tokens || "—" }} tokens · {{ row.durationMs }} ms
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.eval {
  container-type: inline-size;
  max-width: 900px;
  margin: 0 auto;
  padding: t.$space-6;

  &__error {
    margin: 0 0 t.$space-3;
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
    margin: 0 0 t.$space-3;
    font-size: 14px;
    font-weight: 600;
  }

  &__form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: t.$space-3;
    align-items: end;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    min-width: 0;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__actions {
    display: flex;
    gap: t.$space-2;
  }

  &__progress,
  &__hint {
    margin: t.$space-3 0 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    margin-bottom: t.$space-3;
  }

  &__cases,
  &__history {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__case {
    padding: t.$space-3;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-md;
    min-width: 0;

    &--failed {
      border-left: 2px solid var(--error, #{t.$error});
    }
  }

  &__case-head {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__case-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    // flex 子项默认 min-width:auto，不置 0 时长标题会顶掉右侧统计而不是省略。
    min-width: 0;
    @include m.ellipsis;
  }

  &__case-meta {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__case-reason,
  &__case-calls {
    margin: t.$space-1 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__history-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    padding: t.$space-2 t.$space-3;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-sm;
    font-size: 12px;
    min-width: 0;
  }

  &__history-time,
  &__history-meta {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__history-model,
  &__history-role {
    @include m.ellipsis;
    // flex 子项必须显式 min-width: 0 才会真正省略；max-width 只负责封顶。
    min-width: 0;
    max-width: 220px;
    color: var(--text-primary, #{t.$ink});
  }

  &__history-meta {
    margin-left: auto;
  }
}

// 窄容器下配置区改单列：三列在 620px 内会把下拉压到看不全选项。
@container (max-width: 620px) {
  .eval {
    padding: t.$space-4;

    &__form {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
