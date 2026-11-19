<script setup lang="ts">
import { NButton, NTag } from "naive-ui";
import type { AgentPanelState, PendingToolAction } from "@/types";

/**
 * AI 面板里的 Agent 控制区：模式开关 + 写操作授权卡片。
 *
 * 把两者合并成一个组件，是为了让 Copilot 面板只暴露一个 agent prop 与一个 action 事件，
 * 避免父级为了转派五六个细碎事件把文件撑过 500 行。
 * 组件纯展示：模式状态与审批队列都由 useWritingCopilot 持有。
 */
const props = defineProps<{
  agent: AgentPanelState;
}>();

/** 已完成的动作不占位置；失败留下来说明原因。 */
const visible = () => props.agent.actions.filter((item) => item.status !== "applied");

const STATUS_LABEL: Record<PendingToolAction["status"], string> = {
  pending: "待授权",
  approved: "已通过",
  rejected: "已驳回",
  applied: "已应用",
  failed: "失败",
};

/** 从工具结果里取候选正文（propose_text 返回 JSON 文本），非 JSON 当纯文本。 */
function candidate(action: PendingToolAction): string {
  if (action.status !== "applied") return "";
  try {
    const value: unknown = JSON.parse(action.label);
    if (value && typeof value === "object" && "content" in value) {
      const content = (value as { content: unknown }).content;
      return typeof content === "string" ? content : action.label;
    }
  } catch {
    return action.label;
  }
  return action.label;
}
</script>

<template>
  <section class="controls" v-if="agent.mode || visible().length">
    <button
      type="button"
      class="controls__mode"
      :class="{ 'controls__mode--on': agent.mode }"
      @click="agent.onAction({ type: 'toggle' })"
    >
      {{ agent.mode ? "Agent 模式·开" : "Agent 模式·关" }}
    </button>
    <span v-if="agent.progress" class="controls__progress">{{ agent.progress }}</span>

    <div v-for="action in visible()" :key="action.id" class="controls__action">
      <div class="controls__row">
        <NTag
          size="small"
          :bordered="false"
          :type="action.status === 'pending' ? 'warning' : 'default'"
        >
          {{ STATUS_LABEL[action.status] }}
        </NTag>
        <span class="controls__label">{{ action.label }}</span>
      </div>
      <p v-if="action.error" class="controls__error">{{ action.error }}</p>
      <div class="controls__buttons">
        <template v-if="action.status === 'pending'">
          <NButton
            size="tiny"
            type="primary"
            :disabled="agent.busyId === action.id"
            @click="agent.onAction({ type: 'approve', id: action.id })"
            >通过</NButton
          >
          <NButton
            size="tiny"
            :disabled="agent.busyId === action.id"
            @click="agent.onAction({ type: 'reject', id: action.id })"
            >驳回</NButton
          >
        </template>
        <NButton
          v-else-if="candidate(action)"
          size="tiny"
          quaternary
          @click="agent.onAction({ type: 'insert', text: candidate(action) })"
          >插入到正文</NButton
        >
      </div>
    </div>
    <button
      type="button"
      v-if="agent.actions.some((a) => a.status !== 'pending')"
      class="controls__clear"
      @click="agent.onAction({ type: 'clear' })"
    >
      清除记录
    </button>
    <p v-if="agent.error" class="controls__error">{{ agent.error }}</p>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.controls {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  margin: t.$space-2 0;
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  min-width: 0;

  &__mode {
    align-self: flex-start;
    padding: 3px 10px;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
    background: var(--bg-sunken, #{t.$paper-sunken});
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-sm;
    cursor: pointer;

    &--on {
      color: var(--accent, #{t.$accent});
      border-color: var(--accent, #{t.$accent});
    }
  }

  &__progress,
  &__clear {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__clear {
    align-self: flex-end;
    background: none;
    border: none;
    cursor: pointer;
  }

  &__action {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    padding: t.$space-2;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-sm;
    min-width: 0;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__label {
    font-size: 12px;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__error {
    margin: 0;
    font-size: 11px;
    color: var(--error, #{t.$error});
  }

  &__buttons {
    display: flex;
    gap: t.$space-2;
  }
}
</style>
