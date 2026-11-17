<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NButton, NInput, NTag } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import CopilotReferencePicker from "@/components/writing/CopilotReferencePicker.vue";
import {
  COPILOT_QUICK_PROMPTS,
  COPILOT_REF_KIND_LABEL,
  type CopilotMessage,
  type CopilotReference,
} from "@/types";

/**
 * 写作台 Copilot 对话面板。
 *
 * 面板只负责「展示消息 + 收集输入」，请求与流式状态都在 useWritingCopilot 里；
 * 插入正文需要编辑器实例，所以也只发事件，由页面决定怎么落到正文。
 */
const props = defineProps<{
  projectId: string;
  messages: CopilotMessage[];
  streaming: boolean;
  error: string;
  /** 本会话注入的作品上下文字数，让作者知道模型看到了多少背景。 */
  contextChars: number;
  /** 下一条消息要携带的引用。 */
  references: CopilotReference[];
}>();

const emit = defineEmits<{
  (event: "send", text: string): void;
  (event: "stop"): void;
  (event: "clear"): void;
  (event: "pick", reference: CopilotReference): void;
  (event: "unpick", reference: CopilotReference): void;
  (event: "insert", text: string): void;
}>();

const draft = ref("");
const listRef = ref<HTMLElement | null>(null);
// 复制成功后在对应消息上短暂显示「已复制」，避免用全局提示打断写作。
const copiedId = ref("");

const lastMessage = computed(() => props.messages[props.messages.length - 1]);
const canSend = computed(() => !props.streaming && draft.value.trim().length > 0);
const showQuickPrompts = computed(() => props.messages.length === 0 && !props.streaming);

/** 流式过程中内容不断变长，跟着滚到底部，作者不用手动追。 */
watch(
  () => lastMessage.value?.content,
  async () => {
    await nextTick();
    const element = listRef.value;
    if (element) element.scrollTop = element.scrollHeight;
  },
);

function submit(): void {
  if (!canSend.value) return;
  emit("send", draft.value);
  draft.value = "";
}

/** 回车发送、Shift+回车换行，是聊天框的通用习惯。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}

function fillPrompt(prompt: string): void {
  draft.value = prompt;
}

async function copy(message: CopilotMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.content);
    copiedId.value = message.id;
    window.setTimeout(() => {
      if (copiedId.value === message.id) copiedId.value = "";
    }, 1500);
  } catch {
    // 剪贴板在部分环境不可用，静默失败即可，作者仍可手动选中复制。
  }
}

/** 最后一条助手消息在流式中时显示闪烁光标。 */
function isLive(message: CopilotMessage): boolean {
  return props.streaming && message.id === lastMessage.value?.id && message.role === "assistant";
}
</script>

<template>
  <div class="chat">
    <p class="chat__meta">
      <template v-if="contextChars">已注入作品上下文 {{ contextChars }} 字</template>
      <template v-else>发送第一条消息后加载作品上下文</template>
      <span class="chat__meta-gap" />
      <MacButton size="small" :disabled="messages.length === 0" @click="emit('clear')">
        清空对话
      </MacButton>
    </p>

    <div ref="listRef" class="chat__list">
      <div v-if="showQuickPrompts" class="chat__empty">
        <p>问它设定、问它走向、让它帮你理清逻辑。</p>
        <p class="chat__empty-hint">
          想让回答更准，用下面的「＠ 引用」把相关设定或前面的章节带进来。
        </p>
        <div class="chat__prompts">
          <button
            v-for="prompt in COPILOT_QUICK_PROMPTS"
            :key="prompt"
            type="button"
            class="chat__prompt"
            @click="fillPrompt(prompt)"
          >
            {{ prompt }}
          </button>
        </div>
      </div>

      <div
        v-for="message in messages"
        :key="message.id"
        class="chat__row"
        :class="`chat__row--${message.role}`"
      >
        <div class="chat__bubble" :class="{ 'chat__bubble--failed': message.failed }">
          <div v-if="message.references.length" class="chat__refs">
            <NTag
              v-for="reference in message.references"
              :key="`${reference.kind}-${reference.id}`"
              size="small"
              :bordered="false"
            >
              {{ COPILOT_REF_KIND_LABEL[reference.kind] }} · {{ reference.label }}
            </NTag>
          </div>

          <p v-if="!message.content && isLive(message)" class="chat__pending">正在思考…</p>
          <pre
            v-if="message.content"
            class="chat__text"
            :class="{ 'chat__text--live': isLive(message) }"
          >{{
            message.content
          }}</pre>
          <p v-if="message.failed && !message.content" class="chat__failed">这次没有拿到回答。</p>

          <div
            v-if="message.role === 'assistant' && message.content && !isLive(message)"
            class="chat__actions"
          >
            <NButton size="tiny" quaternary @click="copy(message)">
              {{ copiedId === message.id ? "已复制" : "复制" }}
            </NButton>
            <NButton size="tiny" quaternary @click="emit('insert', message.content)">
              插入到正文
            </NButton>
          </div>
        </div>
      </div>
    </div>

    <p v-if="error" class="chat__error">{{ error }}</p>

    <div class="chat__composer">
      <div v-if="references.length" class="chat__refs chat__refs--draft">
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
        v-model:value="draft"
        type="textarea"
        size="small"
        :autosize="{ minRows: 2, maxRows: 5 }"
        placeholder="问点什么，或先「＠引用」相关设定与章节（回车发送，Shift+回车换行）"
        @keydown="handleKeydown"
      />

      <div class="chat__tools">
        <CopilotReferencePicker
          :project-id="projectId"
          :selected="references"
          @pick="emit('pick', $event)"
        />
        <span class="chat__tools-spacer" />
        <MacButton v-if="streaming" size="small" @click="emit('stop')">停止</MacButton>
        <MacButton v-else size="small" variant="prominent" :disabled="!canSend" @click="submit">
          发送
        </MacButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.chat {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  height: 100%;
  min-height: 0;

  &__meta {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__meta-gap {
    flex: 1;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    flex: 1;
    min-height: 160px;
    overflow: auto;
    @include m.thin-scrollbar;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    padding: t.$space-4;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-lg;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});

    p {
      margin: 0;
    }
  }

  &__empty-hint {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__prompts {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin-top: t.$space-2;
  }

  &__prompt {
    padding: t.$space-2 t.$space-3;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-md;
    background: var(--bg-surface);
    text-align: left;
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color t.$duration t.$ease;

    &:hover {
      border-color: var(--accent, #{t.$accent});
    }
  }

  &__row {
    display: flex;
    min-width: 0;

    &--user {
      justify-content: flex-end;
    }
  }

  &__bubble {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    max-width: 100%;
    min-width: 0;
    padding: t.$space-3;
    border-radius: t.$radius-lg;
    background: var(--bg-app);

    // 作者的提问压深一点、靠右，和助手的回答分开看。
    .chat__row--user & {
      background: var(--bg-sunken);
    }

    &--failed {
      border: 1px solid var(--error, #{t.$error});
    }
  }

  &__refs {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-1;
  }

  &__text {
    margin: 0;
    font-family: var(--font-serif, #{t.$font-serif});
    font-size: 13px;
    line-height: 1.8;
    white-space: pre-wrap;
    color: var(--text-primary);
    word-break: break-word;

    &--live::after {
      content: "▌";
      margin-left: 2px;
      color: var(--accent, #{t.$accent});
      animation: copilot-caret 1s steps(1) infinite;
    }
  }

  &__pending,
  &__failed {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__failed {
    color: var(--error, #{t.$error});
  }

  &__actions {
    display: flex;
    gap: t.$space-1;
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

  &__composer {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
  }

  &__refs--draft {
    padding: t.$space-1 0;
  }

  &__tools {
    display: flex;
    align-items: center;
    gap: t.$space-2;
  }

  &__tools-spacer {
    flex: 1;
  }
}

@keyframes copilot-caret {
  50% {
    opacity: 0;
  }
}
</style>
