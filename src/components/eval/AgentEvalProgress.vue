<script setup lang="ts">
import { NProgress, NSpin, NTag } from "naive-ui";
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { AgentEvalProgressState, AgentEvalProgressStep } from "@/types";

/**
 * 评测进行中面板：把「跑了几条 / 正在跑哪条 / 还剩哪些」同时摆出来。
 *
 * 之前只有一行小字，长用例跑几十秒时容易被误以为页面卡住。这里的状态全部由
 * useAgentEval 的进度状态派生，组件只渲染，不自行计时也不猜用例结果。
 */
const props = defineProps<{
  state: AgentEvalProgressState;
  steps: AgentEvalProgressStep[];
  percent: number;
}>();

const phaseLabel = computed(() => {
  if (props.state.phase === "stopping") return "正在停止";
  if (props.state.phase === "preparing") return "准备中";
  return "评测中";
});

const phaseType = computed(() => (props.state.phase === "stopping" ? "warning" : "info"));

/** 当前动作文案：停止请求提交后当前用例仍要跑完，措辞不能暗示已经停下。 */
const currentLabel = computed(() => {
  if (props.state.phase === "stopping") return "停止请求已提交，当前用例跑完后跳过剩余用例";
  if (props.state.phase === "preparing") return "正在加载作品、章节与模型配置…";
  if (!props.state.title) return "正在整理结果…";
  return `正在跑：${props.state.title}`;
});
</script>

<template>
  <div class="eval-progress" role="status" aria-live="polite">
    <div class="eval-progress__head">
      <NTag size="small" :bordered="false" :type="phaseType">{{ phaseLabel }}</NTag>
      <span class="eval-progress__current">
        <NSpin v-if="state.phase !== 'stopping'" :size="12" />
        <span>{{ currentLabel }}</span>
      </span>
      <span class="eval-progress__count">{{ state.done }}/{{ state.total }}</span>
    </div>

    <NProgress
      type="line"
      :percentage="percent"
      :height="6"
      :show-indicator="false"
      :status="phaseType"
      :processing="state.phase !== 'stopping'"
    />

    <ol class="eval-progress__steps">
      <li
        v-for="(step, index) in steps"
        :key="`${index}-${step.title}`"
        class="eval-progress__step"
        :class="`eval-progress__step--${step.status}`"
      >
        <span class="eval-progress__mark">
          <AppIcon v-if="step.status === 'done'" name="check" :size="10" />
          <NSpin v-else-if="step.status === 'active'" :size="12" />
        </span>
        <span class="eval-progress__title">{{ step.title }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.eval-progress {
  min-width: 0;
  margin-top: t.$space-3;
  padding: t.$space-3;
  background: var(--bg-sunken, #{t.$paper-sunken});
  border-radius: t.$radius-md;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
    margin-bottom: t.$space-2;
  }

  &__current {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});

    > span {
      min-width: 0;
      @include m.ellipsis;
    }
  }

  &__count {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__steps {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
    margin: t.$space-3 0 0;
    padding: 0;
    list-style: none;
  }

  &__step {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px t.$space-2;
    border-radius: t.$radius-sm;
    background: var(--bg-surface, #{t.$paper});
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});

    &--done {
      color: var(--text-soft, #{t.$ink-soft});
    }

    &--active {
      color: var(--text-primary, #{t.$ink});
    }
  }

  &__mark {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--divider, #{t.$divider});
    color: var(--bg-surface, #{t.$paper});

    .eval-progress__step--done & {
      background: var(--accent, #{t.$accent});
    }

    .eval-progress__step--active & {
      background: transparent;
    }
  }

  &__title {
    min-width: 0;
    @include m.ellipsis;
  }
}
</style>
