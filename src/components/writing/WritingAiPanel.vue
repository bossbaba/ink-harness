<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NDrawer, NDrawerContent } from "naive-ui";

/**
 * AI 辅助面板：展示流式输出，并让作者决定「插入」「替换选中」还是「重新生成」。
 * 面板本身不调模型，也不碰编辑器——结果与动作都通过 props/emit 交给写作台页面。
 */
defineProps<{
  show: boolean;
  taskLabel: string;
  output: string;
  streaming: boolean;
  error: string;
  canApply: boolean;
  canReplace: boolean;
  /** 本次注入的作品上下文字数，让作者知道模型看到了多少背景。 */
  contextChars: number;
}>();

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
  (event: "retry"): void;
  (event: "insert"): void;
  (event: "replace"): void;
}>();
</script>

<template>
  <NDrawer :show="show" :width="440" placement="right" @update:show="emit('update:show', $event)">
    <NDrawerContent :title="`AI 帮忙 · ${taskLabel}`" closable>
      <div class="assist">
        <p class="assist__meta">
          已注入作品上下文 {{ contextChars }} 字 · 生成内容请自行校订后再用
        </p>

        <p v-if="error" class="assist__error">{{ error }}</p>

        <p v-if="streaming && !output" class="assist__pending">正在生成…</p>

        <pre v-if="output" class="assist__output" :class="{ 'assist__output--live': streaming }">{{
          output
        }}</pre>

        <p v-if="!streaming && !output && !error" class="assist__pending">
          没有拿到内容，可以点「重新生成」再试一次。
        </p>
      </div>

      <template #footer>
        <div class="assist__actions">
          <MacButton size="regular" :disabled="streaming" @click="emit('retry')">
            重新生成
          </MacButton>
          <span class="assist__spacer" />
          <MacButton size="regular" :disabled="!canApply" @click="emit('insert')">
            插入到光标处
          </MacButton>
          <MacButton
            size="regular"
            variant="prominent"
            :disabled="!canApply || !canReplace"
            @click="emit('replace')"
          >
            替换选中
          </MacButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.assist {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-height: 0;

  &__meta {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    margin: 0;
    padding: t.$space-2 t.$space-3;
    border-radius: t.$radius-md;
    background: var(--bg-sunken);
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  &__pending {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__output {
    max-height: calc(100vh - 240px);
    margin: 0;
    padding: t.$space-3;
    overflow: auto;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-md;
    background: var(--bg-app);
    font-family: var(--font-serif, #{t.$font-serif});
    font-size: 14px;
    line-height: 1.95;
    white-space: pre-wrap;
    color: var(--text-primary);
    @include m.thin-scrollbar;

    // 生成过程中在末尾显示一个闪烁光标，提示「还在写」。
    &--live::after {
      content: "▌";
      margin-left: 2px;
      color: var(--accent, #{t.$accent});
      animation: assist-caret 1s steps(1) infinite;
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: t.$space-2;
  }

  &__spacer {
    flex: 1;
  }
}

@keyframes assist-caret {
  50% {
    opacity: 0;
  }
}
</style>
