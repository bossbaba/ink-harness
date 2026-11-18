<script setup lang="ts">
import { NButton, NEmpty, NPopconfirm, NSelect, NTag } from "naive-ui";
import {
  FORESHADOW_STATUS_LABEL,
  FORESHADOW_STATUS_OPTIONS,
  FORESHADOW_STATUS_TAG_TYPE,
  type Foreshadow,
  type ForeshadowStatus,
} from "@/types";

// 伏笔面板：右侧常驻，直接展示「铺设 → 回收」链路并支持就地修改。
const props = defineProps<{
  foreshadows: Foreshadow[];
  chapterOptions: Array<{ label: string; value: string }>;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "create"): void;
  (
    e: "patch",
    foreshadow: Foreshadow,
    patch: Partial<Pick<Foreshadow, "setupChapterId" | "payoffChapterId" | "status">>,
  ): void;
  (e: "remove", foreshadow: Foreshadow): void;
}>();

function setChapter(
  foreshadow: Foreshadow,
  field: "setupChapterId" | "payoffChapterId",
  value: string | null,
): void {
  // 分支写法让 patch 的对象类型保持精确，避免计算属性名被放宽成 string 索引。
  if (field === "setupChapterId") {
    emit("patch", foreshadow, { setupChapterId: value });
  } else {
    emit("patch", foreshadow, { payoffChapterId: value });
  }
}

function setStatus(foreshadow: Foreshadow, value: ForeshadowStatus): void {
  emit("patch", foreshadow, { status: value });
}

// 已回收却没填回收章节属于明显的漏填，给出轻提示而不是阻止保存。
function isIncomplete(foreshadow: Foreshadow): boolean {
  return foreshadow.status === "paid-off" && !foreshadow.payoffChapterId;
}
</script>

<template>
  <aside class="foreshadow">
    <header class="foreshadow__head">
      <div>
        <h2 class="foreshadow__title">伏笔追踪</h2>
        <p class="foreshadow__hint">按「铺设 → 回收」标记，未回收的会一直在列表里。</p>
      </div>
      <NButton size="tiny" quaternary :disabled="props.busy" @click="emit('create')">
        + 新增
      </NButton>
    </header>

    <div class="foreshadow__list">
      <article v-for="item in props.foreshadows" :key="item.id" class="foreshadow-item">
        <div class="foreshadow-item__head">
          <span class="foreshadow-item__title">{{ item.title }}</span>
          <NTag size="tiny" :bordered="false" :type="FORESHADOW_STATUS_TAG_TYPE[item.status]">
            {{ FORESHADOW_STATUS_LABEL[item.status] }}
          </NTag>
        </div>

        <label class="foreshadow-item__field">
          <span class="foreshadow-item__label">铺设章节</span>
          <NSelect
            :value="item.setupChapterId"
            :options="props.chapterOptions"
            size="tiny"
            clearable
            placeholder="未指定"
            @update:value="(value: string | null) => setChapter(item, 'setupChapterId', value)"
          />
        </label>

        <label class="foreshadow-item__field">
          <span class="foreshadow-item__label">回收章节</span>
          <NSelect
            :value="item.payoffChapterId"
            :options="props.chapterOptions"
            size="tiny"
            clearable
            placeholder="未指定"
            @update:value="(value: string | null) => setChapter(item, 'payoffChapterId', value)"
          />
        </label>

        <label class="foreshadow-item__field">
          <span class="foreshadow-item__label">状态</span>
          <NSelect
            :value="item.status"
            :options="FORESHADOW_STATUS_OPTIONS"
            size="tiny"
            @update:value="(value: ForeshadowStatus) => setStatus(item, value)"
          />
        </label>

        <p v-if="isIncomplete(item)" class="foreshadow-item__warn">已回收但未指定回收章节。</p>

        <div class="foreshadow-item__actions">
          <NPopconfirm @positive-click="emit('remove', item)">
            <template #trigger>
              <NButton size="tiny" quaternary type="error" :disabled="props.busy">删除</NButton>
            </template>
            删除这条伏笔记录？
          </NPopconfirm>
        </div>
      </article>

      <NEmpty
        v-if="props.foreshadows.length === 0"
        class="foreshadow__empty"
        size="small"
        :show-icon="false"
        description="还没有记录伏笔。"
      >
        <template #extra>
          <NButton size="tiny" :disabled="props.busy" @click="emit('create')">新增伏笔</NButton>
        </template>
      </NEmpty>
    </div>
  </aside>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.foreshadow {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__hint {
    margin: 2px 0 0;
    font-size: 10px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    max-height: calc(100vh - 260px);
    overflow: auto;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: t.$space-3;
    min-height: 140px;
    padding: t.$space-4;
    text-align: center;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});

    p {
      margin: 0;
    }
  }
}

.foreshadow-item {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  background: var(--bg-app);

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__label {
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__warn {
    margin: 0;
    font-size: 10px;
    color: var(--warning, #{t.$warning});
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
