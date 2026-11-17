<script setup lang="ts">
import { NTag } from "naive-ui";
import RelationGraph from "@/components/RelationGraph.vue";
import { CONSISTENCY_KIND_LABEL, type ConsistencyIssue, type StoryElement } from "@/types";

// 右侧洞察面板：关系图 + 一致性报告。点击某条报告时 emit focusIssue，
// 由父组件清除筛选并定位到出问题的设定，这里不直接改动页面状态。
defineProps<{
  elements: StoryElement[];
  selectedId: string;
  issues: ConsistencyIssue[];
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "focusIssue", issue: ConsistencyIssue): void;
}>();
</script>

<template>
  <aside class="panel">
    <h2 class="panel__title">关系图</h2>
    <RelationGraph
      :elements="elements"
      :selected-id="selectedId"
      @select="emit('select', $event)"
    />
    <div class="issues">
      <h2 class="panel__title">一致性报告</h2>
      <p v-if="issues.length === 0" class="issues__empty">
        点击顶部「一致性检查」查看重复名称与时间线冲突。
      </p>
      <button
        v-for="issue in issues"
        :key="issue.id"
        type="button"
        class="issue"
        @click="emit('focusIssue', issue)"
      >
        <span class="issue__top">
          <NTag
            size="tiny"
            :bordered="false"
            :type="issue.severity === 'warning' ? 'warning' : 'info'"
          >
            {{ CONSISTENCY_KIND_LABEL[issue.kind] }}
          </NTag>
          <span class="issue__title">{{ issue.title }}</span>
        </span>
        <span class="issue__detail">{{ issue.detail }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.panel {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
}

.issues {
  border-top: 1px solid var(--divider, #{t.$divider});
  padding-top: t.$space-4;

  &__empty {
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.issue {
  display: flex;
  flex-direction: column;
  gap: t.$space-1;
  width: 100%;
  margin-bottom: t.$space-2;
  padding: t.$space-2;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-sm;
  background: transparent;
  color: var(--text-primary, #{t.$ink});
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--accent, #{t.$accent});
  }

  &__top {
    display: flex;
    align-items: center;
    gap: t.$space-2;
  }

  &__title {
    font-size: 12px;
  }

  &__detail {
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}
</style>
