<script setup lang="ts">
import { NButton, NEmpty, NInput, NSelect, NTag } from "naive-ui";
import AppEmpty from "@/components/common/AppEmpty.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import PageHeader from "@/components/common/PageHeader.vue";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import { useGlobalBible } from "@/composables/useGlobalBible";
import type { KindFilter } from "@/composables/useStoryBible";
// 关系类型编码（related-to 等）必须转成中文再显示，界面上不允许出现英文枚举值。
import { relationTypeLabel } from "@/types";

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
  goWorkspace,
  kindLabel,
} = useGlobalBible();
</script>

<template>
  <div class="global-bible">
    <!-- 设计稿 3:416：全局视角的眉标 + 30px 标题 + 说明，统一走 PageHeader。 -->
    <PageHeader
      eyebrow="全局视角"
      title="全局设定库"
      subtitle="汇总所有作品的设定，仅用于浏览；编辑请进入对应作品的设定库。"
    />

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
          <LoadingState
            v-if="busy && filtered.length === 0"
            class="item-list__empty"
            variant="inline"
            text="正在载入设定…"
          />
          <NEmpty
            v-else-if="filtered.length === 0"
            class="item-list__empty"
            size="small"
            :show-icon="false"
            description="没有匹配的设定条目。"
          />
        </div>
      </aside>

      <section class="panel panel--detail">
        <template v-if="selected">
          <!-- 设计稿 3:448：类型与名称同一行，进入作品页是主操作，用主按钮。 -->
          <div class="detail-head">
            <div class="detail-head__identity">
              <NTag size="small" :bordered="false" type="success">
                {{ kindLabel(selected.kind) }}
              </NTag>
              <h2 class="detail-head__title serif">{{ selected.name }}</h2>
            </div>
            <NButton size="small" type="primary" @click="openProject(selected)">
              进入该作品设定库
            </NButton>
          </div>
          <p class="detail-head__project">所属作品：{{ selected.projectTitle }}</p>

          <!-- 设计稿 3:456：字段名在上、浅底值块在下，值块统一 9px 圆角与纸灰底色。 -->
          <div class="detail-body">
            <section class="detail-section">
              <h3 class="detail-section__title">摘要</h3>
              <div class="detail-section__value">
                <p>{{ selected.summary || "暂无摘要" }}</p>
              </div>
            </section>
            <section v-if="selected.detail.aliases?.length" class="detail-section">
              <h3 class="detail-section__title">别名</h3>
              <div class="detail-section__value">
                <p>{{ selected.detail.aliases.join("、") }}</p>
              </div>
            </section>
            <section v-if="selected.kind === 'event'" class="detail-section">
              <h3 class="detail-section__title">时间范围</h3>
              <div class="detail-section__value">
                <p>{{ selected.detail.timeStart || "?" }} — {{ selected.detail.timeEnd || "?" }}</p>
              </div>
            </section>
            <section v-if="selected.detail.notes" class="detail-section">
              <h3 class="detail-section__title">补充备注</h3>
              <div class="detail-section__value">
                <p>{{ selected.detail.notes }}</p>
              </div>
            </section>
            <section class="detail-section">
              <h3 class="detail-section__title">关联设定</h3>
              <div class="detail-section__value detail-section__value--relations">
                <p v-if="!selected.detail.relations?.length" class="detail-section__placeholder">
                  暂无关联设定
                </p>
                <p
                  v-for="relation in selected.detail.relations"
                  :key="relation.targetId"
                  class="relation"
                >
                  <NTag size="tiny" :bordered="false">{{ relationTypeLabel(relation.type) }}</NTag>
                  {{ relationName(relation.targetId) }}
                </p>
              </div>
            </section>
          </div>
        </template>
        <AppEmpty
          v-else
          class="panel__empty"
          icon="bible"
          title="还没有设定条目"
          description="进入某部作品的设定库，登记人物、地点与术语，写作时即可引用。"
          action-label="去工作台"
          @action="goWorkspace"
        />
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.global-bible {
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  // 页头已交给 PageHeader，这里只保留只读页的异常文案。
  &__error {
    margin: t.$space-2 0 0;
    font-size: 12px;
    color: var(--error, #{t.$error});
  }
}

.global-grid {
  display: grid;
  // 设计稿 3:420：筛选栏 340px，与详情面板间隔 16px。
  grid-template-columns: 340px minmax(0, 1fr);
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
    // 设计稿 3:441：选中条目用浅绿而非灰底，和全局浏览的只读语义保持一致。
    background: var(--accent-soft, #{t.$accent-soft});
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
    // 设计稿 3:441：选中条目用浅绿而非灰底，和全局浏览的只读语义保持一致。
    background: var(--accent-soft, #{t.$accent-soft});
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
  align-items: center;
  justify-content: space-between;
  gap: t.$space-3;
  min-width: 0;

  // 设计稿 3:449：类型标签与名称同一行，名称可能很长，只让它省略。
  &__identity {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 1.25rem;
    @include m.ellipsis;
  }

  &__project {
    margin: t.$space-2 0 0;
    padding-bottom: t.$space-3;
    border-bottom: 1px solid var(--divider, #{t.$divider});
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
    margin: 0 0 t.$space-2;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted, #{t.$ink-muted});
  }

  p {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
  }

  // 设计稿 3:459：值块是无描边的浅底矩形，9px 圆角、12px 内边距。
  &__value {
    min-height: 40px;
    padding: t.$space-3;
    border-radius: 9px;
    background: var(--bg-control, #{t.$paper-sunken});

    &--relations {
      min-height: 60px;
    }
  }

  &__placeholder {
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.relation {
  display: flex;
  align-items: center;
  gap: t.$space-2;
}
</style>
