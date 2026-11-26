<script setup lang="ts">
import { NButton } from "naive-ui";
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { AgentRolePreset } from "@/services/agentRolePresets";

/**
 * 预设角色卡片区：把内置模板摆出来，点「添加」即复制成一条可编辑的角色。
 *
 * 只负责展示与派发事件，不直接调 service：是否已添加由父级按角色名判断，
 * 添加动作也由父级统一走 useAgentRoles，避免这里再写一份请求与错误处理。
 */
const props = defineProps<{
  presets: AgentRolePreset[];
  /** 当前库里已有的角色名，用来把已添加的卡片标成不可重复添加。 */
  addedNames: string[];
  /** 正在添加的预设名，用于按钮 loading；空串表示空闲。 */
  busyName?: string;
}>();

const emit = defineEmits<{ add: [preset: AgentRolePreset] }>();

const addedSet = computed(() => new Set(props.addedNames));

function isAdded(preset: AgentRolePreset): boolean {
  return addedSet.value.has(preset.name);
}
</script>

<template>
  <section class="presets">
    <header class="presets__head">
      <h2 class="presets__title">预设角色</h2>
      <!-- 设计稿 3:562：提示强调「预设可复制成自建角色」，避免用户以为预设只能只读使用。 -->
      <p class="presets__hint">选择一个角色预设，即可在写作台调用；已添加的角色可直接使用。</p>
    </header>

    <ul class="presets__grid">
      <li v-for="preset in presets" :key="preset.key" class="presets__card">
        <span class="presets__icon"><AppIcon :name="preset.icon" :size="18" /></span>
        <div class="presets__body">
          <span class="presets__name">{{ preset.name }}</span>
          <p class="presets__summary">{{ preset.summary }}</p>
        </div>
        <NButton
          class="presets__add"
          size="small"
          :type="isAdded(preset) ? 'default' : 'primary'"
          :disabled="isAdded(preset)"
          :loading="busyName === preset.name"
          @click="emit('add', preset)"
        >
          {{ isAdded(preset) ? "已添加" : "添加" }}
        </NButton>
      </li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.presets {
  container-type: inline-size;

  &__head {
    display: flex;
    align-items: baseline;
    gap: t.$space-3;
    min-width: 0;
    margin-bottom: t.$space-3;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    flex-shrink: 0;
  }

  &__hint {
    margin: 0;
    min-width: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }

  &__grid {
    display: grid;
    // 用 min(260px, 100%) 而不是写死 260px：面板被 Copilot 挤窄时降成一列，
    // 不会因为最小列宽超过容器而产生横向滚动条。
    grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
    gap: t.$space-3;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__card {
    display: flex;
    align-items: flex-start;
    gap: t.$space-3;
    min-width: 0;
    // 设计稿 3:564：预设卡是纸白卡面 + 分隔线，68px 高，和下方列表卡保持同一层级。
    min-height: 68px;
    padding: t.$space-3;
    background: var(--bg-surface, #{t.$paper-raised});
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-md;
  }

  // 按钮固定在卡片右上，不跟着摘要换行被拉窄或换行。
  &__add {
    flex-shrink: 0;
    align-self: center;
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: t.$radius-sm;
    background: var(--bg-surface, #{t.$paper});
    color: var(--accent, #{t.$accent});
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__name {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__summary {
    margin: t.$space-1 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-soft, #{t.$ink-soft});
    // 摘要统一两行内：卡片高度一致，按钮不会因为文案长短上下错位。
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}

@container (max-width: 620px) {
  .presets__head {
    flex-direction: column;
    gap: t.$space-1;
  }
}
</style>
