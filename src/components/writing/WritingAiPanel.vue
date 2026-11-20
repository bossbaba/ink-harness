<script setup lang="ts">
import { NButton, NInput, NTag } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import AgentControls from "@/components/writing/AgentControls.vue";
import CopilotReferencePicker from "@/components/writing/CopilotReferencePicker.vue";
import WritingAssistCard from "@/components/writing/WritingAssistCard.vue";
import {
  type AgentPanelState,
  type AssistCardState,
  COPILOT_QUICK_PROMPTS,
  COPILOT_REF_KIND_LABEL,
  type CopilotMessage,
  type CopilotReference,
  type StoryElement,
} from "@/types";

/**
 * 写作台的 AI 面板（第三栏）：对话为主，另外承载一次性的写作辅助结果。
 *
 * 辅助曾经是独立的抽屉，会盖住这一栏；合并后作者在同一个地方看到
 * 「我问了什么」「我让它改了什么」，结果仍由卡片里的插入/替换决定是否进稿。
 * 面板只负责展示，请求与流式状态都在 useWritingCopilot / useWritingAssist 里。
 */
const props = defineProps<{
  messages: CopilotMessage[];
  streaming: boolean;
  error: string;
  /** 本会话注入的作品上下文字数，让作者知道模型看到了多少背景。 */
  contextChars: number;
  /** 下一条消息要携带的引用。 */
  references: CopilotReference[];
  /** @引用 选择器的候选数据，来自 useWritingCopilot。 */
  referenceElements: StoryElement[];
  referenceChapters: Array<{ id: string; act: number; title: string }>;
  referenceLoading: boolean;
  referenceError: string;
  /** 检索索引状态文案，如「索引 12 段 · 已过期」；空串表示还没读到。 */
  ragLabel: string;
  /** 索引在建完之后又改过内容或换了模型，建议重建。 */
  ragStale: boolean;
  ragBusy: boolean;
  ragError: string;
  /** 上一次提问检索到的片段数，0 表示没有参考资料可注入。 */
  retrievedCount: number;
  /** 当前这次写作辅助（续写/改写等）的结果卡片；visible 为假时不渲染。 */
  assist: AssistCardState;
  agent: AgentPanelState;
}>();

const emit = defineEmits<{
  (event: "send", text: string): void;
  (event: "stop"): void;
  (event: "clear"): void;
  (event: "pick", reference: CopilotReference): void;
  (event: "unpick", reference: CopilotReference): void;
  /** @引用 面板展开，通知父级加载候选。 */
  (event: "open-reference"): void;
  (event: "insert", text: string): void;
  /** 重建检索索引：耗时随作品规模增长，由父级负责 loading 与错误。 */
  (event: "reindex"): void;
  /** 辅助卡片的动作，回写正文由父级拿编辑器实例完成。 */
  (event: "assist-stop"): void;
  (event: "assist-retry"): void;
  (event: "assist-insert"): void;
  (event: "assist-replace"): void;
}>();

const draft = ref("");
const listRef = ref<HTMLElement | null>(null);
// 复制成功后在对应消息上短暂显示「已复制」，避免用全局提示打断写作。
const copiedId = ref("");

const lastMessage = computed(() => props.messages[props.messages.length - 1]);
const canSend = computed(() => !props.streaming && draft.value.trim().length > 0);
// 辅助卡片在下面时不再提示「问点什么」，否则两块引导会互相抢注意力。
const showQuickPrompts = computed(
  () => props.messages.length === 0 && !props.streaming && !props.assist.visible,
);

/** 流式过程中内容不断变长，跟着滚到底部，作者不用手动追。 */
watch(
  () => `${lastMessage.value?.content ?? ""}|${props.assist.output}`,
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
      <!-- 与下一行的「更新索引」同一形态：行内轻量操作统一用 NButton quaternary tiny，
           保证同一组按钮高度和圆角一致。 -->
      <NButton size="tiny" quaternary :disabled="messages.length === 0" @click="emit('clear')">
        清空对话
      </NButton>
    </p>

    <!-- 索引状态与维护入口：检索是隐式行为，作者需要知道它有没有生效、是不是过期了。 -->
    <p class="chat__rag">
      <span class="chat__rag-text" :class="{ 'chat__rag-text--stale': ragStale }">
        {{ ragLabel || "检索索引待检测" }}
      </span>
      <span v-if="retrievedCount" class="chat__rag-note">
        本次检索到 {{ retrievedCount }} 段资料
      </span>
      <span class="chat__meta-gap" />
      <NButton size="tiny" quaternary :loading="ragBusy" @click="emit('reindex')">
        更新索引
      </NButton>
    </p>
    <p v-if="ragError" class="chat__rag-error">{{ ragError }}</p>

    <div ref="listRef" class="chat__list">
      <div v-if="showQuickPrompts" class="chat__empty">
        <p>问它设定、问它走向、让它帮你理清逻辑。</p>
        <p class="chat__empty-hint">
          想让回答更准，用下面的「＠ 引用」把相关设定或前面的章节带进来。
        </p>
        <p class="chat__empty-hint">
          选中正文后用编辑器工具条的改写 / 扩写 / 润色，结果也会出现在这里，确认后再插入。
        </p>
        <div class="chat__prompts">
          <NButton
            v-for="prompt in COPILOT_QUICK_PROMPTS"
            :key="prompt"
            size="small"
            block
            class="chat__prompt"
            @click="fillPrompt(prompt)"
          >
            {{ prompt }}
          </NButton>
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

      <!-- 辅助结果紧跟对话流末尾：它是「刚才那个动作」的结果，不是一条聊天消息。 -->
      <WritingAssistCard
        :state="assist"
        @stop="emit('assist-stop')"
        @retry="emit('assist-retry')"
        @insert="emit('assist-insert')"
        @replace="emit('assist-replace')"
      />

      <!-- Agent 控制区：模式开关 + 写操作授权。 -->
      <AgentControls :agent="agent" />
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
          :selected="references"
          :elements="referenceElements"
          :chapters="referenceChapters"
          :loading="referenceLoading"
          :error="referenceError"
          @pick="emit('pick', $event)"
          @open="emit('open-reference')"
        />
        <span class="chat__tools-spacer" />
        <NButton v-if="streaming" size="small" @click="emit('stop')">停止</NButton>
        <NButton v-else size="small" type="primary" :disabled="!canSend" @click="submit">
          发送
        </NButton>
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
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__meta-gap {
    flex: 1;
  }

  // 索引状态行：状态文字可以长，右侧按钮始终靠右，窄栏时整行换行。
  &__rag {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__rag-text--stale {
    color: var(--warning, #{t.$warning});
  }

  &__rag-note {
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__rag-error {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--error, #{t.$error});
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    flex: 1;
    // 常驻侧栏高度有限：消息区只吃剩余空间并自己滚动，保证底部输入框始终可见。
    min-height: 0;
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

  // 双写类名压过 NButton 默认样式，保留快捷提问卡片的边框与左对齐排版。
  &__prompt.chat__prompt {
    height: auto;
    padding: t.$space-2 t.$space-3;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: t.$radius-md;
    background: var(--bg-surface);
    text-align: left;
    font-size: 12px;
    color: var(--text-primary);
    white-space: normal;
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
