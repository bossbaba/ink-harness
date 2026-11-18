<script setup lang="ts">
import { NButton, NEmpty, NTag, NTooltip } from "naive-ui";
import { useRouter } from "vue-router";
import AppIcon from "@/components/common/AppIcon.vue";
import NewProjectDialog from "@/components/NewProjectDialog.vue";
import { useWorkspace } from "@/composables/useWorkspace";
import { PROJECT_STATUS_LABEL } from "@/types";

const router = useRouter();
// 数据与本地运行时状态由 composable 负责，本页只保留导航与模板组装。
const {
  app,
  backend,
  projects,
  dbInfo,
  showNew,
  error,
  ollamaRunning,
  ollamaModels,
  ollamaError,
  ollamaStarting,
  startOllama,
  loadProjects,
} = useWorkspace();

// 新建作品弹窗创建成功后的回调：重新拉取列表，让新作品立即出现在卡片区。
async function onCreated() {
  await loadProjects();
}

function openBible(projectId: string): void {
  // 从作品卡片直接进入该作品的设定库，而不是跳到全局页再隐式限定作用域。
  void router.push({ name: "project-bible", params: { projectId } });
}

function openOutline(projectId: string): void {
  // 大纲同样是作品内页面，入口直接带上 projectId 跳转。
  void router.push({ name: "project-outline", params: { projectId } });
}

function openIdeation(projectId: string): void {
  // 构思向导挂在作品下，复用同一套作品作用域与面包屑。
  void router.push({ name: "project-ideation", params: { projectId } });
}

function openWriting(projectId: string): void {
  // 写作台不带章节 id 进入，避免替用户默认选中某一章。
  void router.push({ name: "project-writing", params: { projectId } });
}

function openPublish(projectId: string): void {
  // 出版中心属于某部作品，路径上必须带 projectId；全局菜单的同名项仍是禁用占位。
  void router.push({ name: "project-publish", params: { projectId } });
}

function openWorkflow(projectId: string): void {
  // 创作工作流是作品内页面，入口同样带上 projectId 跳转。
  void router.push({ name: "project-workflow", params: { projectId } });
}

function openModels(): void {
  // 模型管理是全局页，与当前作品无关，直接按路由名跳转。
  void router.push({ name: "models" });
}
</script>

<template>
  <div class="workspace">
    <section class="hero">
      <h1 class="hero__title serif">开始你的下一部作品</h1>
      <p class="hero__subtitle">从构思到出版，AI 全程辅助，数据留在你的电脑。</p>
      <div class="hero__actions">
        <NButton type="primary" @click="showNew = true">新建作品</NButton>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="section">
      <h2 class="section__title">
        我的作品
        <NTag class="count" size="tiny" round :bordered="false">{{ projects.length }}</NTag>
      </h2>
      <NEmpty
        v-if="projects.length === 0"
        class="empty"
        size="small"
        description="还没有作品。点击「新建作品」开始。"
      />
      <div v-else class="project-grid">
        <article v-for="p in projects" :key="p.id" class="project-card">
          <div class="project-card__head">
            <h3 class="project-card__title serif">{{ p.title }}</h3>
            <NTag size="small" :bordered="false" type="success">
              {{ PROJECT_STATUS_LABEL[p.status] }}
            </NTag>
          </div>
          <p class="project-card__premise">{{ p.premise || "暂无梗概" }}</p>
          <div class="project-card__meta">
            <span>{{ p.genre || "未分类" }}</span>
            <span v-if="p.privacy === 'local-only'">仅本地</span>
          </div>
          <div class="project-card__actions">
            <NButton size="small" quaternary @click="openIdeation(p.id)">
              构思向导 <AppIcon name="chevron-right" :size="13" />
            </NButton>
            <NButton size="small" quaternary @click="openOutline(p.id)">
              进入大纲 <AppIcon name="chevron-right" :size="13" />
            </NButton>
            <NButton size="small" quaternary @click="openWriting(p.id)">
              进入写作台 <AppIcon name="chevron-right" :size="13" />
            </NButton>
            <NButton size="small" quaternary @click="openBible(p.id)">
              进入设定库 <AppIcon name="chevron-right" :size="13" />
            </NButton>
            <NButton size="small" quaternary @click="openPublish(p.id)">
              出版中心 <AppIcon name="chevron-right" :size="13" />
            </NButton>
            <NButton size="small" quaternary @click="openWorkflow(p.id)">
              创作工作流 <AppIcon name="chevron-right" :size="13" />
            </NButton>
          </div>
        </article>
      </div>
    </section>

    <section class="status-grid">
      <div class="card">
        <div class="card__label">本地运行时</div>
        <div class="card__value">{{ backend }}</div>
      </div>
      <div class="card">
        <div class="card__label">Ollama 服务</div>
        <div class="card__value">
          <NTag :type="ollamaRunning ? 'success' : 'default'" size="small" :bordered="false">
            {{ ollamaRunning ? "运行中" : "未运行" }}
          </NTag>
          <span v-if="ollamaRunning && ollamaModels.length" class="card__note">
            {{ ollamaModels.length }} 个本地模型
          </span>
        </div>
        <p v-if="ollamaError" class="card__error">{{ ollamaError }}</p>
        <div class="card__links">
          <NButton
            v-if="!ollamaRunning"
            size="small"
            quaternary
            :disabled="ollamaStarting"
            @click="startOllama"
          >
            {{ ollamaStarting ? "启动中…" : "启动本地模型 →" }}
          </NButton>
          <NButton size="small" quaternary @click="openModels">配置模型 →</NButton>
        </div>
      </div>
      <div class="card">
        <div class="card__label">主题</div>
        <div class="card__value">
          {{ app.appearance === "light" ? "浅色 · 纸墨" : "深色 · 夜读" }}
        </div>
      </div>
    </section>

    <!-- 作品库路径可能很长，用 NTooltip 展示完整路径，避免原生 title 的样式与延迟。 -->
    <NTooltip v-if="dbInfo">
      <template #trigger>
        <p class="db-path">作品库：{{ dbInfo.path }}</p>
      </template>
      {{ dbInfo.path }}
    </NTooltip>

    <NewProjectDialog v-model:show="showNew" @created="onCreated" />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.workspace {
  max-width: 900px;
  margin: 0 auto;
  padding: t.$space-8 t.$space-6;
  // 页面根必须声明容器：卡片栅格按「内容区宽度」而不是窗口宽度决定列数，
  // 否则侧栏/专注模式切换时会算出错误的列数。
  container-type: inline-size;
}

.hero {
  padding: t.$space-6 0 t.$space-4;
  text-align: center;

  &__title {
    margin: 0;
    font-size: 2rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-primary);
  }
  &__subtitle {
    margin: t.$space-3 0 t.$space-5;
    font-size: 0.9rem;
    color: var(--text-soft);
  }
  &__actions {
    display: flex;
    justify-content: center;
  }
}

.section {
  margin-top: t.$space-6;

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: t.$space-4;
  }
}

// NTag 自带圆角与配色，这里只补一个与标题的间距。
.count {
  margin-left: t.$space-2;
  vertical-align: middle;
}

.project-grid {
  display: grid;
  // 单列给足宽度：六个入口按钮必须排在同一行，两列时卡片太窄会把按钮组挤到第二行。
  grid-template-columns: minmax(0, 1fr);
  gap: t.$space-4;
}

.project-card {
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }
  &__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    @include m.ellipsis;
  }
  &__premise {
    margin: t.$space-3 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-soft);
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  &__meta {
    display: flex;
    gap: t.$space-3;
    font-size: 11px;
    color: var(--text-faint);
  }
  &__actions {
    display: flex;
    // 六个入口必须排在同一行：卡片已改单列给足宽度，这里禁止换行避免掉到第二行。
    flex-wrap: nowrap;
    gap: t.$space-1;
    margin-top: t.$space-2;
    // NButton 自带 padding，这里不再给按钮加边距，靠 gap 控制间距。
    :deep(button) {
      flex-shrink: 0;
      white-space: nowrap;
    }
  }
}

.empty {
  padding: t.$space-8;
  text-align: center;
  border: 1px dashed var(--divider);
  border-radius: t.$radius-lg;
  color: var(--text-faint);
  font-size: 13px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: t.$space-4;
  margin-top: t.$space-8;
}

.card {
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__label {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--text-faint);
    margin-bottom: t.$space-2;
  }
  &__value {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    font-size: 13px;
    color: var(--text-primary);
  }
  &__note {
    font-size: 11px;
    color: var(--text-faint);
  }
  &__links {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-1;
    margin-top: t.$space-1;
  }
  &__error {
    margin: t.$space-2 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--error, #{t.$error});
  }
}

.db-path {
  margin-top: t.$space-5;
  font-size: 10px;
  color: var(--text-faint);
  @include m.ellipsis;
}

.error {
  color: var(--error, #{t.$error});
  font-size: 12px;
}
</style>
