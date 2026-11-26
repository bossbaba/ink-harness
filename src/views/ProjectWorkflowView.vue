<script setup lang="ts">
import { NTag } from "naive-ui";
import { computed, onMounted } from "vue";
import LoadingState from "@/components/common/LoadingState.vue";
import WorkflowStageCard from "@/components/workflow/WorkflowStageCard.vue";
import { useProjectWorkflow } from "@/composables/useProjectWorkflow";
import type { WorkflowDecision, WorkflowStage, WorkflowState } from "@/types";
import { WORKFLOW_CHAPTER_STAGES, WORKFLOW_STAGES } from "@/types";
import { onReactivated } from "@/utils/lifecycle";

/**
 * 作品内 Agent 工作流：用垂直步骤条展示策划→写作→编辑→审稿→出版。
 * 每一步内嵌操作区，AI 产出候选后由作者审批，通过才落地并解锁下一步。
 */
const props = defineProps<{ projectId: string }>();

const {
  project,
  chapters,
  state,
  loading,
  loadError,
  running,
  received,
  busy,
  error,
  notice,
  isUnlocked,
  load,
  selectChapter,
  run,
  approve,
} = useProjectWorkflow(props.projectId);

const pageTitle = computed(() =>
  project.value ? `《${project.value.title}》· 创作工作流` : "创作工作流",
);

const chapterOptions = computed(() =>
  chapters.value.map((chapter) => ({
    label: `第${chapter.act}幕 · ${chapter.title}`,
    value: chapter.id,
  })),
);

const completedCount = computed(
  () =>
    WORKFLOW_STAGES.filter((item) => state.value?.stages[item.key].status === "approved").length,
);

/** 设计稿 3:1001：顶部进度条按已完成阶段占比填充，分母固定为流水线总步数。 */
const progressPercent = computed(() =>
  WORKFLOW_STAGES.length === 0
    ? 0
    : Math.round((completedCount.value / WORKFLOW_STAGES.length) * 100),
);

/**
 * 单个阶段的视觉状态：通过/打回/进行中/未开始分别对应绿、红、灰点。
 * 保留原来的状态判定口径，只把 Naive UI 步骤条的 status 换成自己的标注。
 */
function stageStatus(
  workflow: WorkflowState,
  stage: WorkflowStage,
): "finish" | "error" | "process" | "wait" {
  const item = workflow.stages[stage];
  if (item.status === "approved") return "finish";
  if (item.status === "rejected") return "error";
  if (item.status === "running" || item.status === "pending") return "process";
  return "wait";
}

/** 状态标签文案与 NTag 类型绑定，避免每步卡片各写一套色值。 */
function stageBadge(status: ReturnType<typeof stageStatus>): {
  label: string;
  type: "success" | "error" | "info" | "default";
} {
  switch (status) {
    case "finish":
      return { label: "通过", type: "success" };
    case "error":
      return { label: "需要重试", type: "error" };
    case "process":
      return { label: "进行中", type: "info" };
    default:
      return { label: "未开始", type: "default" };
  }
}

function stepDescription(stage: WorkflowStage): string {
  const item = state.value?.stages[stage];
  const hint = WORKFLOW_STAGES.find((s) => s.key === stage)?.hint ?? "";
  return item?.model ? `${hint} · 模型：${item.model}` : hint;
}

function runStage(stage: WorkflowStage): void {
  void run(stage);
}

function decide(stage: WorkflowStage, decision: WorkflowDecision, note: string): void {
  void approve(stage, decision, note);
}

function pickChapter(id: string): void {
  void selectChapter(id);
}

onMounted(() => void load());
onReactivated(() => void load());
</script>

<template>
  <div class="workflow">
    <header class="workflow__header">
      <div>
        <h1 class="workflow__title serif">{{ pageTitle }}</h1>
        <p class="workflow__sub">
          流水线共五步，已完成 {{ completedCount }}/{{ WORKFLOW_STAGES.length }}。
          每一步先由 AI 产出候选，<strong>经你审批通过才会写入作品</strong>并解锁下一步。
        </p>
      </div>
    </header>

    <LoadingState v-if="loading" variant="inline" text="正在载入工作流…" />
    <p v-else-if="loadError" class="workflow__status workflow__status--error">{{ loadError }}</p>
    <template v-else-if="state">
      <p v-if="error" class="workflow__status workflow__status--error">{{ error }}</p>
      <p v-if="notice" class="workflow__status workflow__status--notice">{{ notice }}</p>

      <!-- 设计稿 3:1001：先给完成度，再用「圆点 + 卡片」列出每步，不再用步骤条挤压卡片宽度。 -->
      <div class="progress">
        <span class="progress__label">
          {{ completedCount }}/{{ WORKFLOW_STAGES.length }} 已完成
        </span>
        <div class="progress__track">
          <div class="progress__fill" :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>

      <div class="stages">
        <section v-for="item in WORKFLOW_STAGES" :key="item.key" class="stages__row">
          <span class="stages__dot" :class="`stages__dot--${stageStatus(state, item.key)}`" />
          <div class="stages__card">
            <header class="stages__head">
              <h2 class="stages__title serif">{{ item.label }}</h2>
              <NTag
                size="small"
                :bordered="false"
                :type="stageBadge(stageStatus(state, item.key)).type"
              >
                {{ stageBadge(stageStatus(state, item.key)).label }}
              </NTag>
            </header>
            <p class="stages__desc">{{ stepDescription(item.key) }}</p>
            <WorkflowStageCard
              :state="state.stages[item.key]"
              :running="running === item.key"
              :any-running="running !== null"
              :received="received"
              :unlocked="isUnlocked(item.key)"
              :busy="busy"
              :chapter-id="
                WORKFLOW_CHAPTER_STAGES.includes(item.key) ? state.selectedChapterId : null
              "
              :chapter-options="chapterOptions"
              @run="runStage(item.key)"
              @select-chapter="pickChapter"
              @approve="(decision, note) => decide(item.key, decision, note)"
            />
          </div>
        </section>
      </div>

      <footer class="workflow__footer">
        <p>工作流状态保存在本机；审批通过才会写入作品数据，生成结果不自动发布。</p>
      </footer>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.workflow {
  container-type: inline-size;
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
  margin: 0 auto;
  padding: t.$space-6;

  &__header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
    margin-bottom: t.$space-5;
  }

  &__title {
    margin: 0 0 t.$space-2;
    // 设计稿 3:1007：工作流页标题 28px 衬线。
    font-size: 1.75rem;
  }

  &__sub,
  &__status,
  &__footer p {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__status {
    &--error {
      color: var(--error, #{t.$error});
    }

    &--notice {
      color: var(--accent, #{t.$accent});
    }
  }

  // 设计稿 3:1005：完成度用独立进度条表达，叙述不再重复「已完成 N 步」。
  .progress {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin: 0 0 t.$space-5;

    &__label {
      font-size: 11px;
      font-weight: 600;
      color: var(--accent);
    }

    &__track {
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--bg-sunken);
    }

    &__fill {
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      transition: width 240ms t.$ease;
    }
  }

  // 设计稿 3:1009：左侧状态圆点 + 右侧整卡，卡片自己承载标题、状态与操作。
  .stages {
    display: flex;
    flex-direction: column;
    gap: t.$space-4;

    &__row {
      display: flex;
      align-items: flex-start;
      gap: t.$space-3;
      min-width: 0;
    }

    &__dot {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      margin-top: 24px;
      border-radius: 50%;
      background: var(--text-faint);

      &--finish {
        background: var(--accent);
      }

      // 打回用红点、进行中用主色空心点，和卡片上的状态标签保持同一语义。
      &--error {
        background: var(--error);
      }

      &--process {
        border: 2px solid var(--accent);
        background: transparent;
      }
    }

    &__card {
      flex: 1;
      min-width: 0;
      padding: 20px;
      @include m.card-surface(var(--bg-surface));

      // 阶段组件原本自带卡面；这里外层已经是设计稿的整卡，去掉内层重复的描边与内边距。
      :deep(.stage) {
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
      }
    }

    &__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: t.$space-3;
    }

    &__title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }

    &__desc {
      margin: t.$space-2 0 t.$space-4;
      font-size: 11px;
      line-height: 1.6;
      color: var(--text-muted, #{t.$ink-muted});
    }
  }

  &__footer {
    padding-top: t.$space-3;
    border-top: 1px solid var(--divider, #{t.$divider});
  }
}
</style>
