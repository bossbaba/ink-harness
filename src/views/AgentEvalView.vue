<script setup lang="ts">
import { NButton, NCheckbox, NSelect, NTag } from "naive-ui";
import { computed, onMounted } from "vue";
import PageHeader from "@/components/common/PageHeader.vue";
import AgentEvalHistoryTable from "@/components/eval/AgentEvalHistoryTable.vue";
import AgentEvalProgress from "@/components/eval/AgentEvalProgress.vue";
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
  chapterId,
  chapters,
  includeReview,
  loading,
  running,
  progressState,
  progressPercent,
  progressSteps,
  error,
  result,
  historyRows,
  rateDelta,
  canRun,
  load,
  run,
  cancel,
  handleProjectChange,
} = useAgentEval();

const projectOptions = computed(() =>
  projects.value.map((item) => ({ label: item.title, value: item.id })),
);
const roleOptions = computed(() => [
  { label: "默认角色（全部工具）", value: "" },
  ...roles.value.map((role) => ({ label: role.name, value: role.id })),
]);
/** 「不指定章节」用于只跑作品级用例；读章节用例会自动跳过。 */
const chapterOptions = computed(() => [
  { label: "不指定章节", value: "" },
  ...chapters.value.map((chapter) => ({ label: chapter.title, value: chapter.id })),
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

/** 趋势标签：上涨用成功色、下跌用警告色（回归告警），持平保持中性。 */
function deltaType(delta: number | null): "success" | "warning" | "default" {
  if (delta === null || delta === 0) return "default";
  return delta > 0 ? "success" : "warning";
}

/** 差值文案：箭头表方向，绝对值交给读者判断，避免「↓ -20%」这种双重否定。 */
function deltaText(delta: number | null): string {
  if (delta === null) return "无历史可比";
  if (delta === 0) return "与上次持平";
  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}% 较上次`;
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
            :value="projectId"
            size="small"
            :options="projectOptions"
            placeholder="选择一部作品"
            :disabled="running"
            @update:value="handleProjectChange"
          />
        </label>
        <label class="eval__field">
          <span class="eval__label">评测章节</span>
          <NSelect
            v-model:value="chapterId"
            size="small"
            :options="chapterOptions"
            :disabled="running"
          />
        </label>
        <div class="eval__role-row">
          <label class="eval__field">
            <span class="eval__label">角色</span>
            <NSelect
              v-model:value="roleId"
              size="small"
              :options="roleOptions"
              :disabled="running"
            />
          </label>
          <div class="eval__actions">
            <NButton v-if="!running" size="small" type="primary" :disabled="!canRun" @click="run">
              开始评测
            </NButton>
            <NButton v-else size="small" @click="cancel">停止</NButton>
          </div>
        </div>
        <label class="eval__field eval__field--check">
          <NCheckbox v-model:checked="includeReview" :disabled="running" size="small">
            纳入审稿用例（内部再调一次模型，约双倍耗时）
          </NCheckbox>
        </label>
      </div>
      <!-- 长用例要跑几十秒，进度面板让「正在跑 / 跑到第几条」一眼可见。 -->
      <AgentEvalProgress
        v-if="running"
        :state="progressState"
        :steps="progressSteps"
        :percent="progressPercent"
      />
    </section>

    <section v-if="result" class="eval__card">
      <div class="eval__head">
        <h2 class="eval__section">本次结果</h2>
        <NTag size="small" :bordered="false" :type="rateType(lastRate)">
          通过率 {{ lastRate }}%（{{ result.passed }}/{{ result.cases.length }}）
        </NTag>
        <!-- 通过率下降要显眼：这是「换模型/改提示词后变差」的直接信号。 -->
        <NTag size="small" :bordered="false" :type="deltaType(rateDelta)">
          {{ deltaText(rateDelta) }}
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
        <NButton
          class="eval__refresh"
          size="small"
          type="primary"
          quaternary
          :loading="loading"
          @click="load"
        >
          刷新
        </NButton>
      </div>

      <AgentEvalHistoryTable :rows="historyRows" :loading="loading" />
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.eval {
  container-type: inline-size;
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
  margin: 0 auto;
  // 设计稿主内容区内边距 32px（space-6 + space-2）。
  padding: calc(#{t.$space-6} + #{t.$space-2});

  &__error {
    margin: 0 0 t.$space-3;
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  &__card {
    @include m.card-surface(var(--bg-surface));
    // 设计稿运行配置卡内边距 22px、历史卡 20px，取 22px 兼顾两者。
    padding: calc(#{t.$space-5} - 2px);
    margin-bottom: calc(#{t.$space-4} + 2px);
  }

  &__section {
    margin: 0 0 calc(#{t.$space-3} + 2px);
    font-size: 15px;
    font-weight: 600;
  }

  &__form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: calc(#{t.$space-4} + #{t.$space-1});
    row-gap: t.$space-3;
    align-items: end;

    // 设计稿的下拉是「无描边 + 纸色底 + 深色文字」的整块控件；Naive UI 默认
    // disabled 会把已选文字压成浅灰，看起来像没填。这里覆盖主题变量，让运行中
    // 仍然能读出当前作品/章节/角色，同时保留 disabled 的交互含义。
    :deep(.n-base-selection) {
      // Naive UI 把这些变量以内联 style 写在根节点上，必须 !important 才能覆盖。
      --n-color: var(--bg-control, #{t.$paper}) !important;
      --n-color-disabled: var(--bg-control, #{t.$paper}) !important;
      --n-text-color: var(--text-primary, #{t.$ink}) !important;
      --n-text-color-disabled: var(--text-primary, #{t.$ink}) !important;
      --n-placeholder-color: var(--text-faint, #{t.$ink-faint}) !important;
      --n-placeholder-color-disabled: var(--text-faint, #{t.$ink-faint}) !important;
      --n-arrow-color: var(--text-primary, #{t.$ink}) !important;
      --n-arrow-color-disabled: var(--text-primary, #{t.$ink}) !important;
      --n-border: none !important;
      --n-border-hover: none !important;
      --n-border-focus: none !important;
      --n-border-radius: #{t.$radius-md} !important;
      --n-font-size: 11px !important;
      // 标签本身是 36px 高且 align-items:center；上下padding设 0 才能真正垂直居中，
      // 给上下各 10px 反而会让 16.5px 行高超出容器、视觉上偏下。
      --n-height: 36px !important;
      --n-padding-single-top: 0 !important;
      --n-padding-single-bottom: 0 !important;
      --n-padding-single-left: 12px !important;
      --n-padding-single-right: 12px !important;
      min-height: 36px;
      border-radius: t.$radius-md;
      background: var(--bg-control, #{t.$paper});
    }
  }

  // 设计稿里角色独占一行，开始/停止按钮贴在其右侧，避免四列把下拉压窄。
  &__role-row {
    display: flex;
    grid-column: 1 / -1;
    align-items: flex-end;
    gap: calc(#{t.$space-4} + #{t.$space-1});
    min-width: 0;

    .eval__field {
      flex: 1;
    }
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: calc(#{t.$space-2} - 2px);
    min-width: 0;

    // 审稿开关没有上方标签，靠跨整行与上方字段拉开距离。
    &--check {
      grid-column: 1 / -1;
    }
  }

  &__label {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-muted, #{t.$ink-muted});
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    gap: t.$space-2;

    :deep(.n-button) {
      min-height: 36px;
      padding: 0 14px;
      border-radius: t.$radius-md;
      font-size: 11px;
    }
  }

  // 设计稿勾选项：14px 方框、4px 圆角、10px 次级文字。
  &__field--check {
    :deep(.n-checkbox) {
      --n-size: 14px !important;
      --n-border-radius: 4px !important;
      --n-font-size: 10px !important;
      --n-text-color: var(--text-muted, #{t.$ink-muted}) !important;
      --n-text-color-disabled: var(--text-muted, #{t.$ink-muted}) !important;
      --n-color: var(--bg-control, #{t.$paper}) !important;
    }
  }

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    margin-bottom: calc(#{t.$space-2} + 2px);
  }

  &__refresh {
    margin-left: auto;
    font-size: 11px;
  }

  &__cases {
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

}

// 中等容器两列（操作按钮换到第二行），窄容器单列；四列在 900px 内会把下拉压得过窄。
@container (620px < width <= 1000px) {
  .eval {
    &__form {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
}

@container (max-width: 620px) {
  .eval {
    padding: t.$space-4;

    &__form {
      grid-template-columns: minmax(0, 1fr);
    }

    // 窄容器里按钮换到角色下方并右对齐，保持与主操作同栅格节奏。
    &__role-row {
      flex-wrap: wrap;
    }

    &__actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
}
</style>
