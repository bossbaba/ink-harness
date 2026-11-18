<script setup lang="ts">
import { NEmpty } from "naive-ui";
import { computed } from "vue";
import { RELATION_TYPE_OPTIONS, STORY_KIND_LABEL, type StoryElement } from "@/types";

const props = defineProps<{
  elements: StoryElement[];
  selectedId?: string;
}>();

const emit = defineEmits<(e: "select", id: string) => void>();

// 关系图节点：带上计算好的坐标，模板只管画，不再掺入布局逻辑。
interface GraphNode {
  element: StoryElement;
  x: number;
  y: number;
}

// 中心点取当前选中的设定，未选中时退回第一条；图永远围绕一个中心展开。
const center = computed<StoryElement | null>(
  () =>
    props.elements.find((element) => element.id === props.selectedId) ?? props.elements[0] ?? null,
);

// 关系是有向的，但图上要显示两侧：既收中心指向别人的出边，也收别人指向中心的入边。
// 用 Set 去重，避免 A→B 和 B→A 被画成两个节点。
const related = computed<StoryElement[]>(() => {
  const current = center.value;
  if (!current) return [];
  const ids = new Set<string>();
  for (const relation of current.detail.relations ?? []) {
    ids.add(relation.targetId);
  }
  for (const element of props.elements) {
    if (element.id === current.id) continue;
    if (element.detail.relations?.some((relation) => relation.targetId === current.id)) {
      ids.add(element.id);
    }
  }
  return props.elements.filter((element) => ids.has(element.id) && element.id !== current.id);
});

// 中心固定在画布正中，相关设定按角度均匀铺在半径 108 的圆周上，从正上方开始排。
const nodes = computed<GraphNode[]>(() => {
  if (!center.value) return [];
  const result: GraphNode[] = [{ element: center.value, x: 150, y: 150 }];
  const count = related.value.length;
  related.value.forEach((element, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(count, 1);
    result.push({
      element,
      x: 150 + 108 * Math.cos(angle),
      y: 150 + 108 * Math.sin(angle),
    });
  });
  return result;
});

// 每条连线的标签优先用正向关系的类型；只有反向关系时用反向类型。
// 类型先映射成中文，找不到映射再退回用户自定义的 label，保证线上总有可读文字。
const edges = computed(() => {
  const current = center.value;
  if (!current) return [];
  return related.value.map((element, index) => {
    const forward = current.detail.relations?.find((relation) => relation.targetId === element.id);
    const backward = element.detail.relations?.find((relation) => relation.targetId === current.id);
    const type = forward?.type ?? backward?.type ?? "related-to";
    const label =
      RELATION_TYPE_OPTIONS.find((option) => option.value === type)?.label ??
      forward?.label ??
      backward?.label ??
      type;
    const node = nodes.value[index + 1];
    return {
      id: element.id,
      x: node?.x ?? 150,
      y: node?.y ?? 150,
      label,
    };
  });
});

// 节点宽度有限，过长的名字截断并加省略号，避免文字压到相邻节点。
function shortName(name: string, max = 6): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}
</script>

<template>
  <div class="graph">
    <NEmpty
      v-if="!center"
      class="graph__empty"
      size="small"
      :show-icon="false"
      description="选择作品后添加设定，即可查看关系图。"
    />
    <template v-else>
      <svg class="graph__canvas" viewBox="0 0 300 300" role="img" aria-label="设定关系图">
        <g v-for="edge in edges" :key="`edge-${edge.id}`">
          <line x1="150" y1="150" :x2="edge.x" :y2="edge.y" class="graph__edge" />
          <text :x="(150 + edge.x) / 2" :y="(150 + edge.y) / 2 - 6" class="graph__edge-label">
            {{ edge.label }}
          </text>
        </g>
        <g
          v-for="(node, index) in nodes"
          :key="node.element.id"
          class="graph__node"
          :class="{ 'graph__node--center': index === 0 }"
          @click="emit('select', node.element.id)"
        >
          <circle :cx="node.x" :cy="node.y" :r="index === 0 ? 26 : 21" />
          <text :x="node.x" :y="node.y + 3" class="graph__node-icon">
            {{ STORY_KIND_LABEL[node.element.kind].slice(0, 1) }}
          </text>
          <text :x="node.x" :y="node.y + (index === 0 ? 42 : 36)" class="graph__node-name">
            {{ shortName(node.element.name) }}
          </text>
        </g>
      </svg>
      <NEmpty
        v-if="related.length === 0"
        class="graph__hint"
        size="tiny"
        :show-icon="false"
        description="当前设定还没有关联。在详情中为它添加关系后，这里会显示关系图。"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.graph {
  min-height: 0;

  &__canvas {
    display: block;
    width: 100%;
    max-width: 420px;
    max-height: 320px;
    margin: 0 auto;
  }

  &__edge {
    stroke: var(--accent, #{t.$accent});
    stroke-width: 1.5;
    opacity: 0.55;
  }

  &__edge-label {
    fill: var(--text-faint, #{t.$ink-faint});
    font-size: 10px;
    text-anchor: middle;
  }

  &__node {
    cursor: pointer;

    circle {
      fill: var(--bg-surface, #{t.$paper-raised});
      stroke: var(--divider, #{t.$divider});
      stroke-width: 2;
      transition: stroke t.$duration t.$ease;
    }

    &:hover circle {
      stroke: var(--accent, #{t.$accent});
    }

    &--center circle {
      fill: var(--accent, #{t.$accent});
      stroke: transparent;
    }

    &--center:hover circle {
      stroke: var(--accent, #{t.$accent});
    }
  }

  &__node-icon {
    fill: var(--text-soft, #{t.$ink-soft});
    font-size: 12px;
    text-anchor: middle;
    pointer-events: none;

    .graph__node--center & {
      fill: #fff;
      font-weight: 600;
    }
  }

  &__node-name {
    fill: var(--text-primary, #{t.$ink});
    font-size: 11px;
    text-anchor: middle;
    pointer-events: none;
  }

  &__empty,
  &__hint {
    margin: 0;
    padding: t.$space-4 t.$space-3;
    text-align: center;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
