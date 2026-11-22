<script setup lang="ts">
import { NButton, NInput, NTag } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import AgentBar from "@/components/writing/AgentBar.vue";
import CopilotReferencePicker from "@/components/writing/CopilotReferencePicker.vue";
import {
  type AgentPanelState,
  COPILOT_REF_KIND_LABEL,
  type CopilotReference,
  type StoryElement,
} from "@/types";
import { detectTrigger } from "@/utils/copilotComposer";

/**
 * 对话框的输入区：引用标签 + 文本输入 + 工具行。
 *
 * 单独成组件的直接原因是面板主体已经贴着 500 行上限，而输入区恰好是唯一带本地交互状态的
 * 部分（草稿、快捷符触发、面板展开）。`@` 与工具行的「＠引用」是同一个面板，
 * `/` 与工具行的 Agent 状态条是同一个菜单。
 */
const props = defineProps<{
  /** 下一条消息要携带的引用。 */
  references: CopilotReference[];
  streaming: boolean;
  /** 引用选择器的候选数据，来自 useWritingCopilot。 */
  elements: StoryElement[];
  chapters: Array<{ id: string; act: number; title: string }>;
  loading: boolean;
  error: string;
  /** Agent 模式与角色：既用于工具行状态条，也用于 `/` 快捷菜单。 */
  agent: AgentPanelState;
}>();

const emit = defineEmits<{
  (event: "send", text: string): void;
  (event: "stop"): void;
  (event: "pick", reference: CopilotReference): void;
  (event: "unpick", reference: CopilotReference): void;
  /** 引用面板展开，通知父级加载候选（是否重复请求由 composable 去重）。 */
  (event: "open-reference"): void;
}>();

const draft = ref("");
const referenceOpen = ref(false);
/** Agent 快捷菜单：既可由工具行状态条点开，也可由输入 `/` 唤出。 */
const agentOpen = ref(false);
const inputRef = ref<InstanceType<typeof NInput> | null>(null);

const canSend = computed(() => !props.streaming && draft.value.trim().length > 0);

function submit(): void {
  if (!canSend.value) return;
  emit("send", draft.value);
  draft.value = "";
}

/**
 * 输入框用受控写法（`:value` + `@update:value`）而不是 v-model：
 * 打 `@` / `/` 之后要把这个字符从草稿里摘掉，v-model 下「程序改回草稿」会再触发一次
 * 输入事件，容易形成「删掉又出现」的抖动。
 */
function handleInput(value: string): void {
  const reference = detectTrigger(draft.value, value, "@");
  if (reference) {
    draft.value = reference.draft;
    referenceOpen.value = true;
    emit("open-reference");
    return;
  }

  const agent = detectTrigger(draft.value, value, "/");
  if (agent) {
    draft.value = agent.draft;
    agentOpen.value = true;
    return;
  }

  draft.value = value;
}

/** 回车发送、Shift+回车换行；Esc 收起当前展开的快捷面板。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (referenceOpen.value) {
      referenceOpen.value = false;
      return;
    }
    if (agentOpen.value) {
      agentOpen.value = false;
      return;
    }
  }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}

// 面板关掉后把焦点还给输入框：作者是打 @ 或 / 进来的，选完应该能接着写。
watch([referenceOpen, agentOpen], async ([reference, agent]) => {
  if (reference || agent) return;
  await nextTick();
  inputRef.value?.focus();
});

/** 供父级的快捷提示按钮写入草稿。 */
function setDraft(text: string): void {
  draft.value = text;
  void nextTick().then(() => inputRef.value?.focus());
}

defineExpose({ setDraft });
</script>

<template>
  <div class="composer">
    <div v-if="references.length" class="composer__refs">
      <NTag
        v-for="reference in references"
        :key="`${reference.kind}-${reference.id}`"
        size="small"
        :bordered="false"
        closable
        @close="emit('unpick', reference)"
      >
        {{ COPILOT_REF_KIND_LABEL[reference.kind] }} · {{ reference.label }}
      </NTag>
    </div>

    <NInput
      ref="inputRef"
      :value="draft"
      type="textarea"
      size="small"
      :autosize="{ minRows: 2, maxRows: 5 }"
      placeholder="问点什么；输入 ＠ 引用设定、/ 选 Agent 角色（回车发送，Shift+回车换行）"
      @update:value="handleInput"
      @keydown="handleKeydown"
    />

    <div class="composer__tools">
      <CopilotReferencePicker
        v-model:model-open="referenceOpen"
        :selected="references"
        :elements="elements"
        :chapters="chapters"
        :loading="loading"
        :error="error"
        @pick="emit('pick', $event)"
        @open="emit('open-reference')"
      />
      <AgentBar
        v-model:model-open="agentOpen"
        :agent="agent"
        @open-reference="emit('open-reference')"
      />
      <span class="composer__spacer" />
      <NButton v-if="streaming" size="small" @click="emit('stop')">停止</NButton>
      <NButton v-else size="small" type="primary" :disabled="!canSend" @click="submit">
        发送
      </NButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.composer {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;
  // 父级是 flex 列容器：不锁住的话，消息区一长就可能把输入框压到 0 高度，
  // 表现为「输入框凭空消失」，比让消息区少显示几行要糟得多。
  flex-shrink: 0;
}

// 待发送的引用标签：可能有多条，换行排而不是横向滚动。
.composer__refs {
  display: flex;
  flex-wrap: wrap;
  gap: t.$space-1;
  min-width: 0;
}

.composer__tools {
  display: flex;
  align-items: center;
  gap: t.$space-2;
  min-width: 0;
}

.composer__spacer {
  flex: 1;
}
</style>
