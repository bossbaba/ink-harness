<script setup lang="ts">
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/vue-3";
import { NButton, NTooltip } from "naive-ui";
import { computed, ref, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { AppIconName } from "@/components/common/appIcons";
import type { EditorPayload } from "@/composables/useWritingDesk";
import type { AssistApplyMode, AssistSelection, AssistTask } from "@/types";
import { parseDocument } from "@/utils/tiptap";

/**
 * 正文编辑器（TipTap）。组件自身不存业务状态：
 * 输入通过 update 事件交给上层的自动保存逻辑，外部只在「换章/恢复版本」时改 content。
 *
 * 关键约定：父组件必须用 `:key` 绑到章节（或版本修订号）上，
 * 让编辑器在换内容时重新挂载。这样避免在同一个实例上 setContent 引起的选区错乱，
 * 也让撤销栈天然按章隔离。
 */
const props = defineProps<{
  content: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  (event: "update", payload: EditorPayload): void;
  /** 点了 AI 动作：把任务与选区一起交给页面去请求模型。 */
  (event: "ai", payload: AssistSelection): void;
}>();

const editor = useEditor({
  content: parseDocument(props.content),
  extensions: [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Placeholder.configure({ placeholder: props.placeholder ?? "从第一句话开始……" }),
  ],
  editorProps: {
    attributes: { class: "writing-prose", spellcheck: "false" },
  },
  onUpdate: ({ editor: instance }) => {
    // 把 JSON 直接串化落库；纯文本一并回传，用于前端实时算字数。
    emit("update", { content: JSON.stringify(instance.getJSON()), text: instance.getText() });
  },
});

// TipTap 的 editor 是浅层 ref，选区变化不会触发组件重渲染；
// 用 transaction 计数把工具条的「当前格式」高亮拉起来。
const tick = ref(0);
watch(
  editor,
  (instance) => {
    if (!instance) return;
    instance.on("transaction", () => {
      tick.value += 1;
    });
  },
  { immediate: true },
);

interface ToolItem {
  key: string;
  label: string;
  /** 有图标的按钮走统一 SVG，避免撤销/重做用字符箭头忽然变粗细。 */
  icon?: AppIconName;
  hint: string;
  active: boolean;
  run: () => void;
}

const tools = computed<ToolItem[]>(() => {
  void tick.value; // 依赖 tick，保证格式变化后重算
  const instance = editor.value;
  if (!instance) return [];
  return [
    {
      key: "bold",
      label: "B",
      hint: "加粗",
      active: instance.isActive("bold"),
      run: () => instance.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: "I",
      hint: "倾斜",
      active: instance.isActive("italic"),
      run: () => instance.chain().focus().toggleItalic().run(),
    },
    {
      key: "strike",
      label: "S",
      hint: "删除线",
      active: instance.isActive("strike"),
      run: () => instance.chain().focus().toggleStrike().run(),
    },
    {
      key: "heading",
      label: "H2",
      hint: "小节标题",
      active: instance.isActive("heading", { level: 2 }),
      run: () => instance.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "quote",
      label: "引",
      hint: "引用",
      active: instance.isActive("blockquote"),
      run: () => instance.chain().focus().toggleBlockquote().run(),
    },
    {
      key: "bullet",
      label: "•",
      hint: "无序列表",
      active: instance.isActive("bulletList"),
      run: () => instance.chain().focus().toggleBulletList().run(),
    },
    {
      key: "ordered",
      label: "1.",
      hint: "有序列表",
      active: instance.isActive("orderedList"),
      run: () => instance.chain().focus().toggleOrderedList().run(),
    },
    {
      key: "undo",
      label: "撤销",
      icon: "undo",
      hint: "撤销",
      active: false,
      run: () => instance.chain().focus().undo().run(),
    },
    {
      key: "redo",
      label: "重做",
      icon: "redo",
      hint: "重做",
      active: false,
      run: () => instance.chain().focus().redo().run(),
    },
  ];
});

/** AI 动作定义：除了「续写」，其余都需要先选中一段文字才有意义。 */
const AI_TOOLS: Array<{ task: AssistTask; label: string; needsSelection: boolean }> = [
  { task: "continue", label: "续写", needsSelection: false },
  { task: "rewrite", label: "改写", needsSelection: true },
  { task: "expand", label: "扩写", needsSelection: true },
  { task: "condense", label: "缩写", needsSelection: true },
  { task: "polish", label: "润色", needsSelection: true },
];

const aiTools = computed(() => {
  void tick.value; // 选区变化也走 transaction，靠 tick 重新算可用状态
  const instance = editor.value;
  const hasSelection = instance ? !instance.state.selection.empty : false;
  return AI_TOOLS.map((tool) => ({
    ...tool,
    disabled: !instance || (tool.needsSelection && !hasSelection),
    hint: tool.needsSelection
      ? hasSelection
        ? `AI ${tool.label}选中的文字`
        : `先选中一段文字，再${tool.label}`
      : "从光标处往下续写",
  }));
});

/** 把任务与选区（含选区前的一段正文）打包给页面，由页面去请求模型。 */
function emitAi(task: AssistTask): void {
  const instance = editor.value;
  if (!instance) return;
  const { from, to } = instance.state.selection;
  emit("ai", {
    task,
    text: from === to ? "" : instance.state.doc.textBetween(from, to, "\n"),
    before: instance.state.doc.textBetween(Math.max(0, from - 800), from, "\n"),
    from,
    to,
  });
}

/** 模型与 Copilot 返回的都是纯文本：按空行切段，段内换行压成空格，插进去才是正常段落。 */
function textToParagraphs(text: string): JSONContent[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      type: "paragraph",
      content: [{ type: "text", text: block.replace(/\n/g, " ") }],
    }));
}

/**
 * 把 AI 结果写回正文。
 * 位置来自发起请求时的选区，生成期间正文没被改动过，但为了稳妥仍按文档长度做钳制，
 * 避免越界位置直接把编辑器搞崩。
 */
function applyAssist(text: string, from: number, to: number, mode: AssistApplyMode): void {
  const instance = editor.value;
  const plain = text.trim();
  if (!instance || !plain) return;

  const size = instance.state.doc.content.size;
  const start = Math.min(Math.max(0, from), size);
  const end = Math.min(Math.max(start, to), size);
  const nodes = textToParagraphs(plain);
  if (nodes.length === 0) return;

  const chain = instance.chain().focus();
  if (mode === "replace") {
    chain.setTextSelection({ from: start, to: end }).deleteSelection().insertContent(nodes).run();
  } else {
    chain.setTextSelection(end).insertContent(nodes).run();
  }
}

/**
 * Copilot 的「插入到正文」：没有发起时的选区，就插在编辑器当前光标处。
 * 用 Editor 里的 selection 而不是 DOM 光标，因为焦点这时可能还在 Copilot 输入框上。
 */
function insertAtCursor(text: string): void {
  const instance = editor.value;
  const plain = text.trim();
  if (!instance || !plain) return;
  const nodes = textToParagraphs(plain);
  if (nodes.length === 0) return;
  const position = instance.state.selection.to;
  instance.chain().focus().setTextSelection(position).insertContent(nodes).run();
}

defineExpose({ applyAssist, insertAtCursor });
</script>

<template>
  <div class="editor">
    <div class="editor__toolbar">
      <NTooltip v-for="tool in tools" :key="tool.key" trigger="hover">
        <template #trigger>
          <NButton
            quaternary
            size="small"
            class="editor__tool"
            :class="{ 'editor__tool--active': tool.active }"
            @click="tool.run()"
          >
            <AppIcon v-if="tool.icon" :name="tool.icon" :size="14" />
            <template v-else>{{ tool.label }}</template>
          </NButton>
        </template>
        {{ tool.hint }}
      </NTooltip>
      <span class="editor__divider" />
      <NTooltip v-for="tool in aiTools" :key="tool.task" trigger="hover">
        <template #trigger>
          <NButton
            quaternary
            size="small"
            class="editor__tool editor__tool--ai"
            :disabled="tool.disabled"
            @click="emitAi(tool.task)"
          >
            {{ tool.label }}
          </NButton>
        </template>
        {{ tool.hint }}
      </NTooltip>
    </div>
    <div class="editor__body">
      <EditorContent class="editor__canvas" :editor="editor" />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.editor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: t.$space-2 t.$space-3;
    border-bottom: 1px solid var(--divider, #{t.$divider});
  }

  &__tool {
    min-width: 28px;
    font-size: 12px;

    &--active {
      color: var(--accent, #{t.$accent});
      background: var(--bg-sunken);
    }

    // AI 动作与排版按钮视觉上分开，但仍然同一组件、同一尺寸。
    &--ai {
      color: var(--accent, #{t.$accent});
    }
  }

  &__divider {
    width: 1px;
    margin: 4px t.$space-2;
    background: var(--divider, #{t.$divider});
  }

  &__body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    @include m.thin-scrollbar;
  }

  &__canvas {
    max-width: 760px;
    margin: 0 auto;
    padding: t.$space-6 t.$space-5 t.$space-8;
  }
}

.editor__canvas :deep(.writing-prose) {
  min-height: 60vh;
  outline: none;
  font-family: var(--font-serif, #{t.$font-serif});
  font-size: 15px;
  line-height: 1.95;
  color: var(--text-primary, #{t.$ink});

  p {
    margin: 0 0 1em;
  }

  h2 {
    margin: 1.6em 0 0.6em;
    font-size: 1.25rem;
    font-weight: 600;
  }

  h3 {
    margin: 1.4em 0 0.5em;
    font-size: 1.05rem;
    font-weight: 600;
  }

  blockquote {
    margin: 1em 0;
    padding-left: t.$space-3;
    border-left: 2px solid var(--accent, #{t.$accent});
    color: var(--text-soft, #{t.$ink-soft});
  }

  ul,
  ol {
    margin: 0 0 1em;
    padding-left: 1.4em;
  }

  hr {
    margin: 1.6em 0;
    border: none;
    border-top: 1px solid var(--divider, #{t.$divider});
  }

  // TipTap Placeholder 扩展把占位文案放在 data-placeholder 上，空段落时显示。
  p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-faint, #{t.$ink-faint});
    pointer-events: none;
  }
}
</style>
