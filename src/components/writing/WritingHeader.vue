<script setup lang="ts">
import { NButton, NSelect, NTag } from "naive-ui";
import ChapterSummaryControl from "@/components/writing/ChapterSummaryControl.vue";
import WritingSaveStatus from "@/components/writing/WritingSaveStatus.vue";
import type { SaveState } from "@/composables/useWritingDesk";
import { CHAPTER_STATUS_LABEL, CHAPTER_STATUS_TAG_TYPE, type Chapter, type Project } from "@/types";
import { formatCount } from "@/utils/text";

/**
 * 写作台标题区：作品/章节标题、字数与保存状态，以及右侧操作按钮。
 *
 * 抽成组件是为了把「页面组装」和「操作区」分开：这些按钮只依赖当前章与面板开关，
 * 不碰编辑器实例，放在页面文件里会让它继续逼近 500 行上限。
 * 容器查询仍然生效——最近的 `container-type` 祖先在页面根节点上，跨组件可用。
 */
defineProps<{
  title: string;
  chapter: Chapter | null;
  chapterOptions: Array<{ label: string; value: string }>;
  activeChapterId: string;
  project: Project | null;
  content: string;
  wordCount: number;
  totalWords: number;
  saveState: SaveState;
  lastSavedAt: string;
  copilotOpen: boolean;
  focusMode: boolean;
}>();

const emit = defineEmits<{
  "select-chapter": [chapterId: string];
  save: [];
  "show-versions": [];
  "summary-persisted": [summary: string];
  "go-outline": [];
  "toggle-copilot": [];
  "toggle-focus": [];
}>();
</script>

<template>
  <header class="writing-header">
    <div class="writing-header__titles">
      <h1 class="writing-header__title serif">{{ title }}</h1>
      <p class="writing-header__subtitle">
        <template v-if="chapter">
          <span>{{ chapter.title }}</span>
          <NTag size="small" :bordered="false" :type="CHAPTER_STATUS_TAG_TYPE[chapter.status]">
            {{ CHAPTER_STATUS_LABEL[chapter.status] }}
          </NTag>
          <span>本章 {{ formatCount(wordCount) }} 字</span>
          <span>全书 {{ formatCount(totalWords) }} 字</span>
          <WritingSaveStatus :state="saveState" :saved-at="lastSavedAt" />
        </template>
        <template v-else>从左侧选择章节开始写，正文会在停笔后自动保存。</template>
      </p>
    </div>

    <div class="writing-header__actions">
      <NSelect
        v-if="chapterOptions.length"
        class="writing-header__picker"
        size="small"
        :value="activeChapterId || null"
        :options="chapterOptions"
        placeholder="选择章节"
        @update:value="emit('select-chapter', $event)"
      />
      <NButton
        size="small"
        :loading="saveState === 'saving'"
        :disabled="!activeChapterId"
        @click="emit('save')"
      >
        立即保存
      </NButton>
      <NButton size="small" :disabled="!activeChapterId" @click="emit('show-versions')">
        版本快照
      </NButton>
      <ChapterSummaryControl
        :project="project"
        :chapter="chapter"
        :content="content"
        :disabled="!activeChapterId"
        @persisted="emit('summary-persisted', $event)"
      />
      <NButton size="small" @click="emit('go-outline')">去大纲</NButton>
      <NButton size="small" @click="emit('toggle-copilot')">
        {{ copilotOpen ? "收起 AI 对话" : "AI 对话" }}
      </NButton>
      <NButton size="small" type="primary" @click="emit('toggle-focus')">
        {{ focusMode ? "退出专注" : "专注模式" }}
      </NButton>
    </div>
  </header>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;

.writing-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: t.$space-4;
  // 设计稿 3:919：页头在卡片区之外，只靠 14px 间距与三栏分开，不再画分隔线。
  padding: 0;

  &__titles {
    min-width: 0;
  }

  &__title {
    margin: 0;
    // 设计稿 3:921：作品内页标题 26px 衬线。
    font-size: 1.625rem;
    font-weight: 600;
  }

  &__subtitle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    margin: t.$space-2 0 0;
    font-size: 11px;
    color: var(--text-muted, #{t.$ink-muted});
  }

  &__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;

    // 设计稿 3:923：工具栏按钮 28px 高、10px 字，整组保持同一档。
    :deep(.n-button) {
      height: 28px;
      padding: 0 t.$space-3;
      font-size: 11px;
    }
  }

  // 章节下拉只在窄屏出现，宽屏用左侧列表即可。
  &__picker {
    display: none;
    width: 200px;
  }
}

// 容器查询按页面根节点的内容宽度触发，组件内部同样可用。
@container (max-width: 1000px) {
  .writing-header {
    flex-direction: column;
  }

  .writing-header__actions {
    width: 100%;
  }

  .writing-header__picker {
    display: block;
  }
}
</style>
