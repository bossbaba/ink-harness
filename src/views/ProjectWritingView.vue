<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import LoadingState from "@/components/common/LoadingState.vue";
import ChapterCreateDialogHost from "@/components/writing/ChapterCreateDialogHost.vue";
import WritingAiPanel from "@/components/writing/WritingAiPanel.vue";
import WritingChapterList from "@/components/writing/WritingChapterList.vue";
import WritingEditor from "@/components/writing/WritingEditor.vue";
import WritingEmptyState from "@/components/writing/WritingEmptyState.vue";
import WritingHeader from "@/components/writing/WritingHeader.vue";
import WritingVersionsDrawer from "@/components/writing/WritingVersionsDrawer.vue";
import { useRagIndex } from "@/composables/useRagIndex";
import { useWritingAssist } from "@/composables/useWritingAssist";
import { useWritingCopilot } from "@/composables/useWritingCopilot";
import { useWritingDesk } from "@/composables/useWritingDesk";
import { useAppStore } from "@/stores/app";
import type { AssistApplyMode, AssistSelection, CopilotReference } from "@/types";
import { onReactivated } from "@/utils/lifecycle";
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
  actCount,
  chaptersLoading,
  createChapter,
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
  snapshotBusy,
  restoreBusy,
  previewBusy,
  previewVersion,
  onEditorUpdate,
  patchChapter,
  flush,
  createSnapshot,
  openVersionPreview,
  closeVersionPreview,
  restoreVersion,
} = useWritingDesk(props.projectId, () => props.chapterId ?? "");

/**
 * 离开写作台前把待保存内容落库。
 *
 * 页面被 keep-alive 缓存时走的是 deactivated 而不是 unmount，那里只能 `void flush()`
 * 不阻塞跳转；切章、去审稿、回工作台都在路由上发生，所以必须在守卫里 await，
 * 否则最后 1~2 秒（防抖窗口内）的输入会随切页丢掉。
 */
onBeforeRouteLeave(async () => {
  await flush();
  return true;
});

// 两个 AI 入口共用同一份章节口径，避免各写一遍标题格式。
const chapterTitle = () =>
  activeChapter.value ? `第${activeChapter.value.act}幕 · ${activeChapter.value.title}` : "";
const chapterSummary = () => activeChapter.value?.summary ?? "";

// AI 辅助：请求与流式收字在组合式函数里，结果以卡片形式进右侧 AI 面板，
// 插入/替换仍由这里拿编辑器实例完成（组合式函数不碰编辑器）。
const {
  target: assistTarget,
  output: assistOutput,
  card: assistCard,
  run: runAssist,
  refreshContext: refreshAssistContext,
  retry: retryAssist,
  stop: stopAssist,
  close: closeAssist,
} = useWritingAssist({
  projectId: props.projectId,
  project: () => project.value,
  chapterTitle,
  chapterSummary,
});

// Copilot 对话：与「AI 辅助」共用同一份作品上下文口径，但结果是对话，需要作者确认才进正文。
const {
  messages: copilotMessages,
  streaming: copilotStreaming,
  error: copilotError,
  contextChars: copilotContextChars,
  references: copilotReferences,
  retrievedCount: copilotRetrieved,
  referenceElements: copilotReferenceElements,
  referenceChapters: copilotReferenceChapters,
  referenceLoading: copilotReferenceLoading,
  referenceError: copilotReferenceError,
  loadReferences: loadCopilotReferences,
  send: sendCopilot,
  refreshContext: refreshCopilotContext,
  stop: stopCopilot,
  clear: clearCopilot,
  addReference: addCopilotReference,
  removeReference: removeCopilotReference,
  agentPanel,
  sessionBar,
} = useWritingCopilot({
  projectId: props.projectId,
  project: () => project.value,
  chapterTitle,
  chapterSummary,
  chapterId: () => loadedChapterId.value,
  insertAtCursor: (text) => editorRef.value?.insertAtCursor(text),
  chapterText: () => {
    const text = documentToPlainText(content.value);
    return text === EMPTY_DOCUMENT_TEXT ? "" : text;
  },
});

// 检索索引按作品维护：状态与「更新索引」都放在 AI 对话面板里，写作时不打扰。
const {
  status: ragStatus,
  busy: ragBusy,
  error: ragError,
  label: ragLabel,
  refresh: refreshRag,
  reindex: reindexRag,
} = useRagIndex(() => props.projectId, { refreshOn: () => app.copilotOpen });

// 去大纲页补了章节/伏笔再回来，必须重取作品上下文，否则 AI 还会按旧大纲写作；
// 索引状态也要重读：AI 面板默认是展开的，只靠「面板开合」监听回到页面时不会触发。
onReactivated(() => {
  void refreshAssistContext();
  void refreshCopilotContext();
  void refreshRag();
});

// 收起面板时作废进行中的辅助请求，避免关掉后还在后台收字。
watch(
  () => app.copilotOpen,
  (open) => {
    if (!open) closeAssist();
  },
);

// 卡片里的「插入/替换」用的是旧选区坐标，换章或恢复版本后位置已失效，直接作废。
watch([loadedChapterId, editorRevision], () => closeAssist());

/** 引用是开关语义：已引用的再点一次就取消，省得另做一个删除入口。 */
function toggleCopilotReference(reference: CopilotReference): void {
  const picked = copilotReferences.value.some(
    (item) => item.kind === reference.kind && item.id === reference.id,
  );
  if (picked) removeCopilotReference(reference);
  else addCopilotReference(reference);
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

// 建章弹窗的字段与保存流程在子组件里，页面只负责打开它并在建好后跳到新章。
const chapterDialogRef = ref<InstanceType<typeof ChapterCreateDialogHost> | null>(null);
function openCreateChapter(act: number): void {
  chapterDialogRef.value?.open(act);
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
  <div class="writing">
    <WritingHeader
      :title="pageTitle"
      :chapter="activeChapter"
      :chapter-options="chapterOptions"
      :active-chapter-id="activeChapterId"
      :project="project"
      :content="content"
      :word-count="wordCount"
      :total-words="totalWords"
      :save-state="saveState"
      :last-saved-at="lastSavedAt"
      :copilot-open="app.copilotOpen"
      :focus-mode="app.focusMode"
      @select-chapter="openChapter"
      @save="flush()"
      @show-versions="showVersions = true"
      @summary-persisted="
        (value: string) => activeChapter && patchChapter(activeChapter.id, { summary: value })
      "
      @go-outline="goOutline"
      @toggle-copilot="app.toggleCopilot()"
      @toggle-focus="toggleFocus"
    />

    <p v-if="error" class="writing__error">{{ error }}</p>

    <div
      class="writing__body"
      :class="{
        'writing__body--copilot': app.copilotOpen,
        'writing__body--assist': app.copilotOpen && assistCard.visible,
      }"
    >
      <WritingChapterList
        class="writing__chapters"
        :groups="chaptersByAct"
        :active-chapter-id="activeChapterId"
        :loading="chaptersLoading"
        :total-words="totalWords"
        @select="openChapter"
        @add-chapter="openCreateChapter"
      />

      <div class="writing__main">
        <LoadingState v-if="contentLoading" variant="inline" text="正在载入正文…" />
        <!-- 设计稿 3:943/3:946：空状态文案按稿收紧，行动入口直接叫「去大纲创建」。 -->
        <WritingEmptyState
          v-else-if="!activeChapterId"
          title="还没有选择章节"
          hint="在左侧点击一章开始写，或点击列表顶部的「＋」直接新建。"
          action-label="去大纲创建"
          @action="goOutline"
        />
        <WritingEmptyState
          v-else-if="!loadedChapterId"
          title="这一章的正文没能载入。"
          hint="请按上方提示检查后，重新点选该章节再试。"
        />
        <WritingEditor
          v-else
          ref="editorRef"
          :key="editorKey"
          :content="content"
          placeholder="从第一句话开始……"
          @update="onEditorUpdate"
          @ai="
            (selection: AssistSelection) => {
              app.copilotOpen = true;
              void runAssist(selection);
            }
          "
        />
      </div>

      <WritingAiPanel
        v-if="app.copilotOpen"
        class="writing__copilot"
        :messages="copilotMessages"
        :streaming="copilotStreaming"
        :error="copilotError"
        :context-chars="copilotContextChars"
        :references="copilotReferences"
        :reference-elements="copilotReferenceElements"
        :reference-chapters="copilotReferenceChapters"
        :reference-loading="copilotReferenceLoading"
        :reference-error="copilotReferenceError"
        :rag-label="ragLabel"
        :rag-stale="ragStatus?.stale ?? false"
        :rag-busy="ragBusy"
        :rag-error="ragError"
        :retrieved-count="copilotRetrieved"
        :assist="assistCard"
        :agent="agentPanel"
        :session="sessionBar"
        @reindex="reindexRag"
        @send="(text: string) => sendCopilot(text)"
        @stop="stopCopilot"
        @clear="clearCopilot"
        @pick="toggleCopilotReference"
        @unpick="removeCopilotReference"
        @open-reference="() => void loadCopilotReferences()"
        @insert="(text: string) => editorRef?.insertAtCursor(text)"
        @assist-stop="stopAssist"
        @assist-retry="retryAssist"
        @assist-insert="applyAssist('insert')"
        @assist-replace="applyAssist('replace')"
      />
    </div>

    <WritingVersionsDrawer
      v-model:show="showVersions"
      :versions="versions"
      :loading="versionsLoading"
      :snapshot-busy="snapshotBusy"
      :restore-busy="restoreBusy"
      :preview-busy="previewBusy"
      :preview="previewVersion"
      @snapshot="createSnapshot"
      @preview="openVersionPreview"
      @restore="handleRestore"
      @close-preview="closeVersionPreview"
    />

    <ChapterCreateDialogHost
      ref="chapterDialogRef"
      :act-count="actCount"
      :create-chapter="createChapter"
      :get-error="() => error"
      @created="openChapter"
    />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.writing {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  height: 100%;
  min-height: 0;
  // 设计稿 3:918：内容区四边 28px，页头与三栏之间 14px。
  padding: 28px;
  container-type: inline-size;
  background: var(--bg-app);

  &__error {
    margin: 0;
    font-size: 12px;
    color: var(--error, #{t.$error});
  }

  &__body {
    display: grid;
    min-width: 0;
    // 设计稿 3:930：章节 196px + 编辑器弹性 + Copilot 300px，栏间 12px。
    grid-template-columns: 196px minmax(0, 1fr);
    gap: 12px;
    flex: 1;
    min-height: 0;

    // AI 面板是第三栏；辅助卡片里是要进稿的长正文，结果出来时这一栏再放宽。
    &--copilot {
      grid-template-columns: 196px minmax(0, 1fr) 300px;
    }
    &--assist {
      grid-template-columns: 196px minmax(0, 1fr) 380px;
    }
  }

  // 三栏各自是一张卡面，圆角/描边/阴影走同一套令牌；子组件只管内部排版。
  &__chapters,
  &__main,
  &__copilot {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: 14px;
    background: var(--bg-surface);
    box-shadow: t.$shadow-card;
  }

  // 章节列表原本自带右分隔线与底色，卡片化后交给外层，避免双描边。
  &__chapters :deep(.chapter-list) {
    border-right: none;
    background: transparent;
  }

  &__main {
    display: flex;
    flex-direction: column;
  }

  // AI 对话栏：常驻在编辑器右侧；自己的 flex 纵向布局不动，这里只做卡片外壳与内边距。
  &__copilot {
    padding: t.$space-4;
  }
}

@container (max-width: 1000px) {
  // 窄屏用标题栏下拉切章，把左侧列表让给 AI 对话；两栏时辅助卡片不再加宽。
  .writing__body--copilot .writing__chapters {
    display: none;
  }

  .writing__body--copilot {
    grid-template-columns: minmax(0, 1fr) 300px;
  }

  .writing__body--assist {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
}

@container (max-width: 620px) {
  // 窄内容区收小页面留白，卡片本身已经提供呼吸空间。
  .writing {
    padding: t.$space-4;
  }

  .writing__body {
    grid-template-columns: minmax(0, 1fr);
  }

  // 单栏时对话整行下沉到编辑器下方，上下各占一半；横着分栏会把正文挤没。
  .writing__body--copilot {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 50%);
  }

  // 单栏时左侧列表让位，切章靠标题栏下拉框。
  .writing__chapters {
    display: none;
  }
}
</style>
