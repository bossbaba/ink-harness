<script setup lang="ts">
import { NButton, NEmpty, NInput, NSelect, NTag } from "naive-ui";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import { useGlobalBible } from "@/composables/useGlobalBible";
import type { KindFilter } from "@/composables/useStoryBible";

// 全局设定库页面，只负责组装界面；跨作品汇总、筛选与跳转逻辑都在 useGlobalBible 中。
// 这里是只读视角，编辑入口由 openProject 跳到对应作品内页面。
const {
  projectFilter,
  filterKind,
  keyword,
  selectedId,
  error,
  busy,
  kindOptions,
  projectOptions,
  filtered,
  selected,
  selectElement,
  relationName,
  openProject,
  kindLabel,
} = useGlobalBible();
</script>

<template>
  <div class="global-bible">
    <header class="global-bible__header">
      <div>
        <h1 class="global-bible__title serif">全局设定库</h1>
        <p class="global-bible__subtitle">
          汇总所有作品的设定，仅用于浏览；编辑请进入对应作品的设定库。
        </p>
      </div>
    </header>

    <p v-if="error" class="global-bible__error">{{ error }}</p>

    <div class="global-grid">
      <aside class="panel">
        <NSelect
          :value="projectFilter"
          :options="projectOptions"
          placeholder="按作品筛选"
          size="small"
          @update:value="(value: string) => (projectFilter = value)"
        />
        <SegmentedControl
          wrap
          :options="kindOptions"
          :model-value="filterKind"
          @update:model-value="(value: string) => (filterKind = value as KindFilter)"
        />
        <NInput
          v-model:value="keyword"
          placeholder="搜索名称、别名、作品或摘要"
          size="small"
          clearable
        />
        <div class="item-list">
          <NButton
            v-for="item in filtered"
            :key="item.id"
            text
            block
            class="item"
            :class="{ 'item--active': item.id === selectedId }"
            @click="selectElement(item.id)"
          >
            <span class="item__head">
              <span class="item__name">{{ item.name }}</span>
              <NTag size="tiny" :bordered="false">{{ kindLabel(item.kind) }}</NTag>
            </span>
            <span class="item__project">{{ item.projectTitle }}</span>
          </NButton>
          <NEmpty
            v-if="filtered.length === 0"
            class="item-list__empty"
            size="small"
            :show-icon="false"
            :description="busy ? '加载中…' : '没有匹配的设定条目。'"
          />
        </div>
      </aside>

      <section class="panel panel--detail">
        <template v-if="selected">
          <div class="detail-head">
            <div>
              <NTag size="small" :bordered="false">{{ kindLabel(selected.kind) }}</NTag>
              <h2 class="detail-head__title serif">{{ selected.name }}</h2>
              <p class="detail-head__project">所属作品：{{ selected.projectTitle }}</p>
            </div>
            <NButton size="small" @click="openProject(selected)"> 进入该作品设定库 </NButton>
          </div>

          <div class="detail-body">
            <section class="detail-section">
              <h3 class="detail-section__title">摘要</h3>
              <p>{{ selected.summary || "暂无摘要" }}</p>
            </section>
            <section v-if="selected.detail.aliases?.length" class="detail-section">
              <h3 class="detail-section__title">别名</h3>
              <p>{{ selected.detail.aliases.join("、") }}</p>
            </section>
            <section v-if="selected.kind === 'event'" class="detail-section">
              <h3 class="detail-section__title">时间范围</h3>
              <p>{{ selected.detail.timeStart || "?" }} — {{ selected.detail.timeEnd || "?" }}</p>
            </section>
            <section v-if="selected.detail.notes" class="detail-section">
              <h3 class="detail-section__title">补充备注</h3>
              <p>{{ selected.detail.notes }}</p>
            </section>
            <section class="detail-section">
              <h3 class="detail-section__title">关联设定</h3>
              <NEmpty
                v-if="!selected.detail.relations?.length"
                class="detail-section__empty"
                size="small"
                :show-icon="false"
                description="暂无关联。"
              />
              <p
                v-for="relation in selected.detail.relations"
                :key="relation.targetId"
                class="relation"
              >
                <NTag size="tiny" :bordered="false">{{ relation.type }}</NTag>
                {{ relationName(relation.targetId) }}
              </p>
            </section>
          </div>
        </template>
        <NEmpty
          v-else
          class="panel__empty"
          size="small"
          description="暂无设定条目。请进入某部作品的设定库添加。"
        />
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.global-bible {
  max-width: 1400px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  &__subtitle,
  &__error {
    margin: t.$space-2 0 0;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__error {
    color: var(--error, #{t.$error});
  }
}

.global-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: t.$space-4;
  margin-top: t.$space-5;
  align-items: start;
  min-width: 0;

  @container (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.panel {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 220px;
    padding: t.$space-5 t.$space-4;
    text-align: center;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.panel--detail {
  min-height: 260px;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 120px;
  max-height: calc(100vh - 260px);
  overflow: auto;

  &__empty {
    margin: 0;
    padding: t.$space-4;
    text-align: center;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: t.$space-2;
  border: none;
  border-radius: t.$radius-sm;
  background: transparent;
  color: var(--text-primary, #{t.$ink});
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }

  &--active {
    background: var(--bg-sunken, #{t.$paper-sunken});
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__name {
    font-size: 12px;
    font-weight: 600;
    @include m.ellipsis;
  }

  &__project {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }
}

// NButton text 变体自带 padding/居中，双写类名把设定条目的列表布局覆盖回来。
.item.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: t.$space-2;
  border: none;
  border-radius: t.$radius-sm;
  background: transparent;
  color: var(--text-primary, #{t.$ink});
  font-size: inherit;
  text-align: left;
  white-space: normal;

  &:hover {
    background: var(--bg-hover);
  }

  &.item--active {
    background: var(--bg-sunken, #{t.$paper-sunken});
  }

  // 名称行与作品名在 .n-button__content 这一层纵向排列。
  :deep(.n-button__content) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    white-space: normal;
  }
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: t.$space-3;
  padding-bottom: t.$space-3;
  border-bottom: 1px solid var(--divider, #{t.$divider});

  &__title {
    margin: t.$space-1 0 0;
    font-size: 1.15rem;
  }

  &__project {
    margin: t.$space-1 0 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
  padding-top: t.$space-4;
}

.detail-section {
  &__title {
    margin: 0 0 t.$space-1;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-soft, #{t.$ink-soft});
  }

  p {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
  }

  &__empty {
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.relation {
  display: flex;
  align-items: center;
  gap: t.$space-2;
}
</style>
