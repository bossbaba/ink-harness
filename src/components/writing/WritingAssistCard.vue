<script setup lang="ts">
import { NButton } from "naive-ui";
import type { AssistCardState } from "@/types";

/**
 * 写作辅助的结果卡片：一次续写 / 改写 / 扩写 / 缩写 / 润色的产出。
 *
 * 与对话气泡的区别在于结果会直接进稿：所以必须给出明确的「插入 / 替换」动作，
 * 且结果只跟当次选区绑定。
 *
 * 卡片没有「收起 / 丢弃」按钮：结果的去向只有两种——点插入或替换进稿，
 * 或者被下一次辅助动作、换章/恢复版本覆盖掉。多一个按钮只会让作者
 * 在「只是折叠」和「丢掉草稿」之间猜，而后者没有撤销。
 */
defineProps<{
  state: AssistCardState;
}>();

const emit = defineEmits<{
  (event: "stop"): void;
  (event: "retry"): void;
  (event: "insert"): void;
  (event: "replace"): void;
}>();
</script>

<template>
  <section v-if="state.visible" class="task">
    <p class="task__title">AI 帮忙 · {{ state.taskLabel }}</p>

    <p class="task__meta">
      已注入上下文 {{ state.contextChars }} 字<template v-if="state.retrievedCount">
        · 检索到 {{ state.retrievedCount }} 段资料</template
      >
    </p>

    <p v-if="state.error" class="task__error">{{ state.error }}</p>
    <p v-if="state.streaming && !state.output" class="task__pending">正在生成…</p>
    <pre
      v-if="state.output"
      class="task__output"
      :class="{ 'task__output--live': state.streaming }"
    >{{ state.output }}</pre>
    <p v-if="!state.streaming && !state.output && !state.error" class="task__pending">
      没有拿到内容，可以点「重新生成」再试一次。
    </p>

    <div class="task__actions">
      <!-- 流式中给「停止」：生成可能持续几十秒，得能中断；停止后已收到的文字仍可插入。 -->
      <NButton v-if="state.streaming" size="tiny" quaternary @click="emit('stop')"> 停止 </NButton>
      <NButton v-else size="tiny" quaternary @click="emit('retry')">重新生成</NButton>
      <span class="task__spacer" />
      <NButton size="tiny" quaternary :disabled="!state.canApply" @click="emit('insert')">
        插入到光标处
      </NButton>
      <NButton
        size="tiny"
        quaternary
        :disabled="!state.canApply || !state.canReplace"
        @click="emit('replace')"
      >
        替换选中
      </NButton>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.task {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  // 左侧一道强调色：一眼能看出这条不是聊天，而是「可以进稿的结果」。
  border-left: 2px solid var(--accent, #{t.$accent});
  border-radius: t.$radius-lg;
  background: var(--bg-app);

  &__title {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__meta {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  &__pending {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__output {
    max-height: 320px;
    margin: 0;
    overflow: auto;
    font-family: var(--font-serif, #{t.$font-serif});
    font-size: 13px;
    line-height: 1.8;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
    @include m.thin-scrollbar;

    &--live::after {
      content: "▌";
      margin-left: 2px;
      color: var(--accent, #{t.$accent});
      animation: task-caret 1s steps(1) infinite;
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-1;
  }

  &__spacer {
    flex: 1;
  }
}

@keyframes task-caret {
  50% {
    opacity: 0;
  }
}
</style>
