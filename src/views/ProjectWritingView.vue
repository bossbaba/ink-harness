<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NDrawer, NDrawerContent, NSelect, NTag } from "naive-ui";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DraftVersionPanel from "@/components/writing/DraftVersionPanel.vue";
import WritingAiPanel from "@/components/writing/WritingAiPanel.vue";
import WritingChapterList from "@/components/writing/WritingChapterList.vue";
import WritingCopilotDrawer from "@/components/writing/WritingCopilotDrawer.vue";
import WritingEditor from "@/components/writing/WritingEditor.vue";
import { useWritingAssist } from "@/composables/useWritingAssist";
import { useWritingCopilot } from "@/composables/useWritingCopilot";
import { useWritingDesk } from "@/composables/useWritingDesk";
import { useAppStore } from "@/stores/app";
import {
  type AssistApplyMode,
  type AssistSelection,
  CHAPTER_STATUS_LABEL,
  CHAPTER_STATUS_TAG_TYPE,
  type CopilotReference,
} from "@/types";
import { formatCount, formatDateTime } from "@/utils/text";
import { documentToPlainText, EMPTY_DOCUMENT_TEXT } from "@/utils/tiptap";

/**
 * 写作台：作品内页面，章节由路径参数决定（`/projects/:projectId/write/:chapterId`）。
 * 没有 chapterId 时不自动选中第一章，而是提示用户从左侧列表挑一章，
 * 避免用户不知道自己正在改哪一章。
 */
const props = defineProps<{
  projectId: string;
  chapterId?: string;
}>();

const router = useRouter();
const app = useAppStore();
const showVersions = ref(false);
// AI 结果的回写要动编辑器，所以这里拿组件实例；编辑器自己负责选区与位置钳制。
const editorRef = ref<InstanceType<typeof WritingEditor> | null>(null);

const {
  project,
  chaptersByAct,
  chaptersLoading,
  activeChapter,
  activeChapterId,
  loadedChapterId,
  content,
  contentLoading,
  wordCount,
  totalWords,
  error,
  saveState,
  lastSavedAt,
  editorRevision,
  versions,
  versionsLoading,
  versionsBusy,
  previewVersion,
  onEditorUpdate,
  flush,
  createSnapshot,
  openVersionPreview,
  closeVersionPreview,
  restoreVersion,
} = useWritingDesk(props.projectId, () => props.chapterId ?? "");

// AI 辅助：请求与流式收字在组合式函数里，插入/替换由这里调用编辑器实例完成。
const {
  show: assistShow,
  taskLabel: assistTaskLabel,
  target: assistTarget,
  output: assistOutput,
  streaming: assistStreaming,
  error: assistError,
  contextChars: assistContextChars,
  canApply: assistCanApply,
  run: runAssist,
  retry: retryAssist,
  close: closeAssist,
} = useWritingAssist({
  projectId: props.projectId,
  project: () => project.value,
  chapterTitle: () =>
    activeChapter.value ? `第${activeChapter.value.act}幕 · ${activeChapter.value.title}` : "",
  chapterSummary: () => activeChapter.value?.summary ?? "",
});

const assistCanReplace = computed(() => Boolean(assistTarget.value?.text));

// Copilot 对话：与「AI 辅助」共用同一份作品上下文口径，但结果是对话，需要作者确认才进正文。
const {
  messages: copilotMessages,
  streaming: copilotStreaming,
  error: copilotError,
  contextChars: copilotContextChars,
  references: copilotReferences,
  send: sendCopilot,
  stop: stopCopilot,
  clear: clearCopilot,
  addReference: addCopilotReference,
  removeReference: removeCopilotReference,
} = useWritingCopilot({
  projectId: props.projectId,
  project: () => project.value,
  chapterTitle: () =>
    activeChapter.value ? `第${activeChapter.value.act}幕 · ${activeChapter.value.title}` : "",
  chapterSummary: () => activeChapter.value?.summary ?? "",
  // 用内存里的正文（而不是库里的），这样刚敲下的句子也能立刻参与讨论。
  chapterText: () => {
    const text = documentToPlainText(content.value);
    return text === EMPTY_DOCUMENT_TEXT ? "" : text;
  },
});

/** 引用是开关语义：已引用的再点一次就取消，省得另做一个删除入口。 */
function toggleCopilotReference(reference: CopilotReference): void {
  const picked = copilotReferences.value.some(
    (item) => item.kind === reference.kind && item.id === reference.id,
  );
  if (picked) removeCopilotReference(reference);
  else addCopilotReference(reference);
}

function sendCopilotMessage(text: string): void {
  void sendCopilot(text);
}

/** Copilot 的回答只做草稿：作者点「插入到正文」才落到光标处，自动保存随后接管。 */
function insertCopilotText(text: string): void {
  editorRef.value?.insertAtCursor(text);
}

// 用户直接从右上角关掉抽屉时也要让进行中的请求作废，避免关掉后还在后台收字。
watch(assistShow, (value) => {
  if (!value) closeAssist();
});

function handleAi(selection: AssistSelection): void {
  void runAssist(selection);
}

/** 把生成结果写回正文；插入/替换后编辑器会触发 update，自动保存随即接管。 */
function applyAssist(mode: AssistApplyMode): void {
  const target = assistTarget.value;
  if (!target) return;
  editorRef.value?.applyAssist(assistOutput.value, target.from, target.to, mode);
  closeAssist();
}

// 换章或恢复版本时换 key，让编辑器整块重建，撤销栈与选区都不会串章。
// 这里用「已载入正文的章节」而不是路由参数，避免正文还没回来就先按新 id 重建。
const editorKey = computed(() => `${loadedChapterId.value}:${editorRevision.value}`);

/** 窄屏下左侧章节列表被隐藏，用标题栏的下拉框兜住切章能力。 */
const chapterOptions = computed(() =>
  chaptersByAct.value.flatMap((group) =>
    group.chapters.map((chapter) => ({
      label: `第${group.act}幕 · ${chapter.title}`,
      value: chapter.id,
    })),
  ),
);

const saveLabel = computed(() => {
  switch (saveState.value) {
    case "dirty":
      return "未保存…";
    case "saving":
      return "保存中…";
    case "saved":
      return lastSavedAt.value ? `已保存 ${formatDateTime(lastSavedAt.value)}` : "已保存";
    case "error":
      return "保存失败";
    default:
      return "";
  }
});

const pageTitle = computed(() => (project.value ? `《${project.value.title}》· 写作台` : "写作台"));

function openChapter(chapterId: string): void {
  if (!chapterId) return;
  void router.push({
    name: "project-writing",
    params: { projectId: props.projectId, chapterId },
  });
}

function goOutline(): void {
  void router.push({ name: "project-outline", params: { projectId: props.projectId } });
}

function toggleFocus(): void {
  app.toggleFocusMode();
}

/** 恢复版本是破坏性操作，面板里已做二次确认，这里只负责执行与关闭弹窗。 */
async function handleRestore(versionId: string): Promise<void> {
  await restoreVersion(versionId);
  closeVersionPreview();
}
</script>

<template>
  <div class="writing" :class="{ 'writing--copilot': app.copilotOpen && !app.focusMode }">
    <header class="writing__header">
      <div class="writing__titles">
        <h1 class="writing__title serif">{{ pageTitle }}</h1>
        <p class="writing__subtitle">
          <template v-if="activeChapter">
            <span>{{ activeChapter.title }}</span>
            <NTag
              size="small"
              :bordered="false"
              :type="CHAPTER_STATUS_TAG_TYPE[activeChapter.status]"
            >
              {{ CHAPTER_STATUS_LABEL[activeChapter.status] }}
            </NTag>
            <span>本章 {{ formatCount(wordCount) }} 字</span>
            <span>全书 {{ formatCount(totalWords) }} 字</span>
            <span v-if="saveLabel" class="writing__save" :class="`writing__save--${saveState}`">
              {{ saveLabel }}
            </span>
          </template>
          <template v-else>从左侧选一章开始写，正文会在停笔后自动保存。</template>
        </p>
      </div>

      <div class="writing__actions">
        <NSelect
          v-if="chapterOptions.length"
          class="writing__picker"
          size="small"
          :value="activeChapterId || null"
          :options="chapterOptions"
          placeholder="选择章节"
          @update:value="openChapter"
        />
        <MacButton size="regular" :disabled="!activeChapterId" @click="flush()">立即保存</MacButton>
        <MacButton size="regular" :disabled="!activeChapterId" @click="showVersions = true">
          版本快照
        </MacButton>
        <MacButton size="regular" @click="goOutline">去大纲</MacButton>
        <MacButton size="regular" @click="app.toggleCopilot()">
          {{ app.copilotOpen ? "收起 AI 对话" : "AI 对话" }}
        </MacButton>
        <MacButton size="regular" variant="prominent" @click="toggleFocus">
          {{ app.focusMode ? "退出专注" : "专注模式" }}
        </MacButton>
      </div>
    </header>

    <p v-if="error" class="writing__error">{{ error }}</p>

    <div class="writing__body">
      <WritingChapterList
        class="writing__chapters"
        :groups="chaptersByAct"
        :active-chapter-id="activeChapterId"
        :loading="chaptersLoading"
        :total-words="totalWords"
        @select="openChapter"
      />

      <div class="writing__main">
        <p v-if="contentLoading" class="writing__hint">正在载入正文…</p>
        <div v-else-if="!activeChapterId" class="writing__empty">
          <p>还没有选择章节。</p>
          <p class="writing__empty-hint">在左侧点一章开始写；如果还没有章节，先去大纲建一章。</p>
          <MacButton size="regular" @click="goOutline">去大纲创建章节</MacButton>
        </div>
        <div v-else-if="!loadedChapterId" class="writing__empty">
          <p>这一章的正文没能载入。</p>
          <p class="writing__empty-hint">请按上方提示检查后，重新点选该章节再试。</p>
        </div>
        <WritingEditor
          v-else
          ref="editorRef"
          :key="editorKey"
          :content="content"
          placeholder="从第一句话开始……"
          @update="onEditorUpdate"
          @ai="handleAi"
        />
      </div>
    </div>

    <NDrawer v-model:show="showVersions" :width="320" placement="right">
      <NDrawerContent title="版本快照" closable>
        <DraftVersionPanel
          :versions="versions"
          :loading="versionsLoading"
          :busy="versionsBusy"
          :preview="previewVersion"
          @snapshot="createSnapshot"
          @preview="openVersionPreview"
          @restore="handleRestore"
          @close-preview="closeVersionPreview"
        />
      </NDrawerContent>
    </NDrawer>

    <WritingCopilotDrawer
      v-model:show="app.copilotOpen"
      :project-id="projectId"
      :messages="copilotMessages"
      :streaming="copilotStreaming"
      :error="copilotError"
      :context-chars="copilotContextChars"
      :references="copilotReferences"
      @send="sendCopilotMessage"
      @stop="stopCopilot"
      @clear="clearCopilot"
      @pick="toggleCopilotReference"
      @unpick="removeCopilotReference"
      @insert="insertCopilotText"
    />

    <WritingAiPanel
      v-model:show="assistShow"
      :task-label="assistTaskLabel"
      :output="assistOutput"
      :streaming="assistStreaming"
      :error="assistError"
      :can-apply="assistCanApply"
      :can-replace="assistCanReplace"
      :context-chars="assistContextChars"
      @retry="retryAssist"
      @insert="applyAssist('insert')"
      @replace="applyAssist('replace')"
    />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.writing {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
  container-type: inline-size;
  background: var(--bg-app);

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
    padding: t.$space-4 t.$space-6;
    border-bottom: 1px solid var(--divider, #{t.$divider});
  }

  &__titles {
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  &__subtitle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    margin: t.$space-2 0 0;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__save {
    &--saving,
    &--dirty {
      color: var(--warning, #{t.$warning});
    }

    &--error {
      color: var(--error, #{t.$error});
    }

    &--saved {
      color: var(--text-faint, #{t.$ink-faint});
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  // 章节下拉只在窄屏出现，宽屏用左侧列表即可。
  &__picker {
    display: none;
    width: 200px;
  }

  &__error {
    margin: t.$space-3 t.$space-6 0;
    font-size: 12px;
    color: var(--error, #{t.$error});
  }

  &__body {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  &__chapters {
    min-width: 0;
  }

  &__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-surface);
    transition: padding-right t.$duration t.$ease;
  }

  &__hint {
    margin: t.$space-6;
    font-size: 12px;
    color: var(--text-faint);
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: t.$space-3;
    min-height: 220px;
    padding: t.$space-6;
    text-align: center;
    font-size: 13px;
    color: var(--text-faint);

    p {
      margin: 0;
    }
  }

  &__empty-hint {
    font-size: 11px;
    color: var(--text-faint);
  }
}

// 宽屏时给抽屉让出等宽内边距，正文整体左移而不是被盖住；窄屏保持覆盖，免得正文被挤没。
@container (min-width: 1000px) {
  .writing--copilot .writing__main {
    padding-right: 380px;
  }
}

@container (max-width: 1000px) {
  .writing__header {
    flex-direction: column;
  }

  .writing__actions {
    width: 100%;
  }

  .writing__picker {
    display: block;
  }
}

@container (max-width: 620px) {
  .writing__body {
    grid-template-columns: minmax(0, 1fr);
  }

  // 单栏时左侧列表让位，切章靠标题栏下拉框。
  .writing__chapters {
    display: none;
  }
}
</style>
