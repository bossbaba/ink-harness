<script setup lang="ts">
import { NButton, NSpace, NSpin } from "naive-ui";
import ChapterEditDialog from "@/components/outline/ChapterEditDialog.vue";
import ForeshadowCreateDialog from "@/components/outline/ForeshadowCreateDialog.vue";
import ForeshadowPanel from "@/components/outline/ForeshadowPanel.vue";
import OutlineBoard from "@/components/outline/OutlineBoard.vue";
import OutlineContextDialog from "@/components/outline/OutlineContextDialog.vue";
import SceneEditDialog from "@/components/outline/SceneEditDialog.vue";
import { useProjectOutline } from "@/composables/useProjectOutline";

// 作品大纲页面：只做组装，章节/场景/伏笔的增删改与排序都在 useProjectOutline。
const props = defineProps<{ projectId: string }>();

const {
  projectTitle,
  chapters,
  foreshadows,
  activeChapterId,
  error,
  busy,
  actCount,
  chapterShow,
  chapterIsNew,
  chapterDraft,
  sceneShow,
  sceneIsNew,
  sceneDraft,
  foreshadowShow,
  foreshadowDraft,
  contextShow,
  contextText,
  contextBusy,
  scenesByChapter,
  foreshadowTags,
  chapterOptions,
  stats,
  selectChapter,
  addAct,
  removeAct,
  openCreateChapter,
  openEditChapter,
  saveChapter,
  removeChapter,
  openCreateScene,
  openEditScene,
  saveScene,
  removeScene,
  openCreateForeshadow,
  saveForeshadow,
  patchForeshadow,
  removeForeshadow,
  moveChapter,
  moveScene,
  openContext,
} = useProjectOutline(props.projectId);
</script>

<template>
  <div class="outline">
    <header class="outline__header">
      <div>
        <h1 class="outline__title serif">
          {{ projectTitle ? `《${projectTitle}》· 大纲` : "作品大纲" }}
        </h1>
        <p class="outline__subtitle">
          按幕组织章节与场景，可继续新增幕；拖拽可调整归属与顺序，伏笔按「铺设 → 回收」追踪。
        </p>
      </div>
      <NSpace>
        <NButton size="small" :disabled="busy || !projectTitle" @click="openContext">
          结构化上下文
        </NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="busy || !projectTitle"
          @click="openCreateChapter(1)"
        >
          新增章节
        </NButton>
      </NSpace>
    </header>

    <p v-if="error" class="outline__error">{{ error }}</p>

    <div v-if="!projectTitle && !error" class="outline__empty">
      <NSpin size="small" />
      <span>正在载入作品大纲…</span>
    </div>

    <template v-else-if="projectTitle">
      <div class="stats">
        <span class="stats__item">章节 <strong>{{ stats.chapters }}</strong></span>
        <span class="stats__item">场景 <strong>{{ stats.scenes }}</strong></span>
        <span class="stats__item">未回收伏笔 <strong>{{ stats.pendingForeshadows }}</strong></span>
        <span class="stats__hint">拖拽章节跨幕移动，拖拽场景跨章调整。</span>
      </div>

      <div class="outline-grid">
        <OutlineBoard
          class="outline-grid__board"
          :chapters="chapters"
          :scenes-by-chapter="scenesByChapter"
          :foreshadow-tags="foreshadowTags"
          :active-chapter-id="activeChapterId"
          :act-count="actCount"
          @move-chapter="moveChapter"
          @move-scene="moveScene"
          @add-chapter="openCreateChapter"
          @add-act="addAct"
          @remove-act="removeAct"
          @select-chapter="selectChapter"
          @edit-chapter="openEditChapter"
          @remove-chapter="removeChapter"
          @add-scene="openCreateScene"
          @edit-scene="openEditScene"
          @remove-scene="removeScene"
        />

        <ForeshadowPanel
          :foreshadows="foreshadows"
          :chapter-options="chapterOptions"
          :busy="busy"
          @create="openCreateForeshadow"
          @patch="patchForeshadow"
          @remove="removeForeshadow"
        />
      </div>
    </template>

    <ChapterEditDialog
      v-model:show="chapterShow"
      v-model:draft="chapterDraft"
      :is-new="chapterIsNew"
      :busy="busy"
      :error="error"
      :act-count="actCount"
      @save="saveChapter"
    />

    <SceneEditDialog
      v-model:show="sceneShow"
      v-model:draft="sceneDraft"
      :is-new="sceneIsNew"
      :busy="busy"
      :error="error"
      @save="saveScene"
    />

    <ForeshadowCreateDialog
      v-model:show="foreshadowShow"
      v-model:draft="foreshadowDraft"
      :busy="busy"
      :error="error"
      :chapter-options="chapterOptions"
      @save="saveForeshadow"
    />

    <OutlineContextDialog
      v-model:show="contextShow"
      :busy="contextBusy"
      :text="contextText"
      @refresh="openContext"
    />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.outline {
  max-width: 1600px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  &__subtitle,
  &__error {
    margin: t.$space-2 0 0;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__error {
    color: var(--error, #{t.$error});
  }

  &__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: t.$space-2;
    margin-top: t.$space-6;
    padding: t.$space-8;
    text-align: center;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-lg;
    color: var(--text-faint, #{t.$ink-faint});
    font-size: 13px;
  }
}

.stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: t.$space-3;
  margin-top: t.$space-5;

  &__item {
    padding: 4px 10px;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: 999px;
    background: var(--bg-surface);
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});

    strong {
      margin-left: 2px;
      color: var(--text-primary, #{t.$ink});
    }
  }

  &__hint {
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.outline-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: t.$space-4;
  margin-top: t.$space-3;
  align-items: start;
  min-width: 0;

  &__board {
    min-width: 0;
  }

  @container (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container (max-width: 620px) {
  .outline__header {
    flex-direction: column;
  }
}
</style>
