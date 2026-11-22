<script setup lang="ts">
import { NButton, NPopover } from "naive-ui";
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { AgentPanelState } from "@/types";

/**
 * 输入框下方的 Agent 状态条：模式开关 + 角色切换。
 *
 * 从消息流里搬下来是因为它属于「这次怎么问」，跟输入框在同一处才顺手；
 * 审批结果仍然留在对话里（AgentControls），那是「上一轮发生了什么」。
 * 面板也可以由输入框打 `/` 直接唤出（见 CopilotComposer）。
 */
const props = defineProps<{ agent: AgentPanelState }>();
const emit = defineEmits<(event: "open-reference") => void>();

const modelOpen = defineModel<boolean>("modelOpen", { default: false });

/** 关着的时候只显示状态，不显示角色名——没开模式时角色本来就不生效。 */
const label = computed(() => {
  if (!props.agent.mode) return "Agent · 关";
  const role = props.agent.roles.find((item) => item.id === props.agent.roleId);
  return role ? `Agent · ${role.name}` : "Agent · 默认";
});

const roleOptions = computed(() => [
  { label: "默认角色（全部工具）", value: "" },
  ...props.agent.roles.map((role) => ({ label: role.name, value: role.id })),
]);

function toggleMode(): void {
  void props.agent.onAction({ type: "toggle" });
}

/**
 * 选角色时顺带把模式打开：只选角色却忘了开开关，是这里最容易踩的坑，
 * 界面上会表现为「选了角色但还是没有工具」。
 */
function chooseRole(id: string): void {
  void props.agent.onAction({ type: "role", id });
  if (!props.agent.mode) void props.agent.onAction({ type: "toggle" });
  modelOpen.value = false;
}

function openReference(): void {
  emit("open-reference");
  modelOpen.value = false;
}
</script>

<template>
  <NPopover v-model:show="modelOpen" trigger="click" placement="top-start" :width="300">
    <template #trigger>
      <NButton size="small" :quaternary="!agent.mode" :type="agent.mode ? 'primary' : 'default'">
        <span class="agentbar__trigger">{{ label }}</span>
      </NButton>
    </template>

    <div class="agentbar">
      <button type="button" class="agentbar__item" @click="toggleMode">
        <span>Agent 模式</span>
        <span class="agentbar__value">{{ agent.mode ? "开" : "关" }}</span>
      </button>
      <p class="agentbar__hint">开启后 AI 才会调用工具读设定、读正文，并把改稿候选交给你审批。</p>

      <div class="agentbar__group">用哪个角色</div>
      <button
        v-for="option in roleOptions"
        :key="option.value || 'default'"
        type="button"
        class="agentbar__item"
        :class="{ 'agentbar__item--active': option.value === agent.roleId }"
        @click="chooseRole(option.value)"
      >
        <span class="agentbar__name">{{ option.label }}</span>
        <AppIcon v-if="option.value === agent.roleId" name="check" :size="13" />
      </button>

      <button type="button" class="agentbar__item agentbar__item--link" @click="openReference">
        ＠ 引用设定或章节
      </button>
    </div>
  </NPopover>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

// 工具行空间很窄：角色名太长就省略，别把发送按钮挤下去。
.agentbar__trigger {
  display: inline-block;
  max-width: 132px;
  @include m.ellipsis;
}

.agentbar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.agentbar__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: t.$space-2;
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-primary, #{t.$ink});
  text-align: left;
  background: none;
  border: none;
  border-radius: t.$radius-sm;
  cursor: pointer;

  &:hover {
    background: var(--bg-sunken, #{t.$paper-sunken});
  }

  &--active {
    color: var(--accent, #{t.$accent});
  }

  &--link {
    justify-content: flex-start;
    margin-top: t.$space-1;
    border-top: 1px solid var(--divider, #{t.$divider});
    padding-top: 8px;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.agentbar__name {
  min-width: 0;
  @include m.ellipsis;
}

.agentbar__value {
  font-size: 11px;
  color: var(--text-faint, #{t.$ink-faint});
}

.agentbar__hint {
  margin: 0;
  padding: 0 8px t.$space-1;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-faint, #{t.$ink-faint});
}

.agentbar__group {
  padding: t.$space-2 8px 2px;
  font-size: 11px;
  color: var(--text-faint, #{t.$ink-faint});
}
</style>
