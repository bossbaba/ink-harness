<script setup lang="ts">
import { NButton, NEmpty, NInput, NPopconfirm, NSelect, NTag } from "naive-ui";
import { ref } from "vue";
import type { Draft } from "@/composables/useStoryBible";
import {
  RELATION_TYPE_OPTIONS,
  relationTypeLabel,
  STORY_KIND_LABEL,
  STORY_KIND_OPTIONS,
  type StoryElement,
  type StoryRelation,
} from "@/types";

const props = defineProps<{
  selected: StoryElement | null;
  projectId: string;
  targetOptions: Array<{ label: string; value: string }>;
  relationTargetName: (id: string) => string;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "delete"): void;
  (e: "new"): void;
  (e: "addRelation", relation: StoryRelation): void;
  (e: "removeRelation", index: number): void;
}>();

const draft = defineModel<Draft>("draft", { required: true });

// 添加关系的临时选择状态：目标 + 关系类型。是否真的入库由父组件的 addRelation 决定。
const relationTarget = ref("");
const relationType = ref("related-to");

function addRelation(): void {
  if (!relationTarget.value) return;
  emit("addRelation", { targetId: relationTarget.value, type: relationType.value });
  // 无论父组件是否接受（可能已存在重复关系）都清空目标框，方便继续添加下一条。
  relationTarget.value = "";
}
</script>

<template>
  <section class="panel panel--detail">
    <template v-if="props.selected">
      <div class="detail-head">
        <div>
          <NTag size="small" :bordered="false">{{ STORY_KIND_LABEL[draft.kind] }}</NTag>
          <h2 class="detail-head__title serif">{{ draft.name || "未命名设定" }}</h2>
        </div>
        <NPopconfirm @positive-click="emit('delete')">
          <template #trigger>
            <NButton size="tiny" quaternary type="error">删除</NButton>
          </template>
          删除后不可恢复，确定继续？
        </NPopconfirm>
      </div>

      <div class="form-grid">
        <label class="field">
          <span class="field__label">类型</span>
          <NSelect v-model:value="draft.kind" :options="STORY_KIND_OPTIONS" size="small" />
        </label>
        <label class="field">
          <span class="field__label">名称</span>
          <NInput v-model:value="draft.name" placeholder="人物、地点或术语名称" size="small" />
        </label>
        <label class="field field--wide">
          <span class="field__label">摘要</span>
          <NInput
            v-model:value="draft.summary"
            type="textarea"
            :rows="2"
            placeholder="一句话说明这条设定的作用"
          />
        </label>
        <label class="field field--wide">
          <span class="field__label">别名（逗号分隔）</span>
          <NInput v-model:value="draft.aliasesText" placeholder="例如：墨、阿墨" size="small" />
        </label>
        <template v-if="draft.kind === 'event'">
          <label class="field">
            <span class="field__label">起始时间</span>
            <NInput v-model:value="draft.timeStart" placeholder="例如：2024-03" size="small" />
          </label>
          <label class="field">
            <span class="field__label">结束时间</span>
            <NInput v-model:value="draft.timeEnd" placeholder="例如：2026" size="small" />
          </label>
        </template>
        <label class="field field--wide">
          <span class="field__label">补充备注</span>
          <NInput
            v-model:value="draft.notes"
            type="textarea"
            :rows="3"
            placeholder="性格、外观、规则、背景……"
          />
        </label>
      </div>

      <div class="relations">
        <div class="relations__head">
          <h3 class="relations__title">关联设定</h3>
          <span class="relations__hint">选择目标后添加，保存后关系图会更新</span>
        </div>
        <div class="relations__add">
          <NSelect
            v-model:value="relationTarget"
            :options="props.targetOptions"
            placeholder="选择关联设定"
            size="small"
            filterable
          />
          <NSelect v-model:value="relationType" :options="RELATION_TYPE_OPTIONS" size="small" />
          <!-- 与同一列表里的「删除」保持同尺寸，行内操作统一 tiny。 -->
          <NButton size="tiny" quaternary :disabled="!relationTarget" @click="addRelation">
            添加
          </NButton>
        </div>
        <NEmpty
          v-if="draft.relations.length === 0"
          class="relations__empty"
          size="tiny"
          :show-icon="false"
          description="暂无关联。"
        />
        <div
          v-for="(relation, index) in draft.relations"
          :key="`${relation.targetId}-${index}`"
          class="relation-row"
        >
          <NTag size="small" :bordered="false">{{ relationTypeLabel(relation.type) }}</NTag>
          <span class="relation-row__target">{{
            props.relationTargetName(relation.targetId)
          }}</span>
          <NButton size="tiny" quaternary type="error" @click="emit('removeRelation', index)">
            移除
          </NButton>
        </div>
      </div>

      <div class="detail-actions">
        <NButton type="primary" :loading="props.busy" @click="emit('save')">保存修改</NButton>
      </div>
    </template>
    <NEmpty
      v-else
      class="panel__empty"
      size="small"
      description="从左侧选择一条设定，或点击「新建设定」开始。"
    >
      <template #extra>
        <NButton type="primary" :disabled="!props.projectId" @click="emit('new')">
          新建设定
        </NButton>
      </template>
    </NEmpty>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.panel {
  min-width: 0;
  min-height: 260px;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: t.$space-4;
    min-height: 220px;
    padding: t.$space-5 t.$space-4;
    text-align: center;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});

    p {
      margin: 0;
    }
  }
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: t.$space-3;
  padding-bottom: t.$space-3;
  border-bottom: 1px solid var(--divider, #{t.$divider});

  &__title {
    margin: t.$space-1 0 0;
    font-size: 1.15rem;
  }
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: t.$space-3;
  margin-top: t.$space-4;
}

@container (max-width: 620px) {
  .form-grid,
  .relations__add {
    grid-template-columns: minmax(0, 1fr);
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;

  &--wide {
    grid-column: 1 / -1;
  }

  &__label {
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.relations {
  margin-top: t.$space-5;
  padding-top: t.$space-4;
  border-top: 1px solid var(--divider, #{t.$divider});

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  &__hint,
  &__empty {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__add {
    display: grid;
    grid-template-columns: 1.4fr 1fr auto;
    gap: t.$space-2;
    margin-top: t.$space-3;
  }

  &__empty {
    padding: t.$space-3 0;
  }
}

.relation-row {
  display: flex;
  align-items: center;
  gap: t.$space-2;
  padding: t.$space-1 0;
  font-size: 12px;

  &__target {
    flex: 1;
    @include m.ellipsis;
  }
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: t.$space-5;
}
</style>
