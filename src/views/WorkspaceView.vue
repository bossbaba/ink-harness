<script setup lang="ts">
import { NButton, NEmpty, NTag, NTooltip } from "naive-ui";
import { useRouter } from "vue-router";
import AppIcon from "@/components/common/AppIcon.vue";
import StatCard from "@/components/common/StatCard.vue";
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
  createProject,
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
  // 出版中心属于某部作品，路径上必须带 projectId；它是作品内页面，不进全局导航。
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
      <div class="hero__content">
        <p class="hero__eyebrow">INK-HARNESS · 创作工作台</p>
        <h1 class="hero__title serif">开始你的下一部作品</h1>
        <p class="hero__subtitle">从构思到出版，AI 全程辅助，数据留在你的电脑。</p>
        <div class="hero__actions">
          <NButton type="primary" size="small" @click="showNew = true">新建作品</NButton>
          <span class="hero__note">本地优先 · 数据不上云</span>
        </div>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="section">
      <h2 class="section__title">
        我的作品
        <NTag class="count" size="tiny" round :bordered="false">{{ projects.length }}</NTag>
      </h2>
      <div v-if="projects.length === 0" class="empty">
        <NEmpty size="small" description="还没有作品，创建第一部开始创作。" />
        <NButton size="small" type="primary" @click="showNew = true">新建作品</NButton>
      </div>
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
      <StatCard label="本地运行时">
        <span class="status-runtime">{{ backend }}</span>
      </StatCard>
      <StatCard label="Ollama 服务">
        <NTag :type="ollamaRunning ? 'success' : 'default'" size="small" :bordered="false">
          {{ ollamaRunning ? "运行中" : "未运行" }}
        </NTag>
        <span v-if="ollamaRunning && ollamaModels.length" class="status-note">
          {{ ollamaModels.length }} 个本地模型
        </span>
        <template #footer>
          <p v-if="ollamaError" class="status-error">{{ ollamaError }}</p>
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
        </template>
      </StatCard>
      <StatCard label="主题" :value="app.appearance === 'light' ? '浅色 · 纸墨' : '深色 · 夜读'" />
    </section>

    <!-- 作品库路径可能很长，用 NTooltip 展示完整路径，避免原生 title 的样式与延迟。 -->
    <NTooltip v-if="dbInfo">
      <template #trigger>
        <p class="db-path">作品库：{{ dbInfo.path }}</p>
      </template>
      {{ dbInfo.path }}
    </NTooltip>

    <NewProjectDialog v-model:show="showNew" :create="createProject" @created="onCreated" />
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

// 首屏 Hero：用一张带主色环境光的面板承接标题与主操作，比居中裸标题更有分量。
.hero {
  position: relative;
  overflow: hidden;
  padding: t.$space-8 t.$space-6;
  border: 1px solid var(--divider);
  border-radius: t.$radius-xl;
  background:
    radial-gradient(120% 180% at 88% 0%, var(--accent-soft), transparent 60%),
    linear-gradient(135deg, var(--bg-surface), var(--bg-sunken));
  box-shadow: t.$shadow-card;

  &__content {
    position: relative;
    z-index: 1;
    max-width: 640px;
  }
  &__eyebrow {
    margin: 0 0 t.$space-3;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    color: var(--accent);
  }
  &__title {
    margin: 0;
    font-size: 2rem;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: 0.04em;
    color: var(--text-primary);
  }
  &__subtitle {
    margin: t.$space-3 0 t.$space-5;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-soft);
  }
  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-3;
  }
  &__note {
    font-size: 11px;
    color: var(--text-faint);
  }
}

.section {
  margin-top: t.$space-6;

  &__title {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    margin: 0 0 t.$space-4;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);

    // 与主色眉标呼应，给「我的作品」一个明确的段落起点。
    &::before {
      content: "";
      width: 3px;
      height: 14px;
      border-radius: 2px;
      background: var(--accent);
    }
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
  // 作品卡片可点入口密集，悬浮抬起给出「可进入」的反馈。
  @include m.hover-lift;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
  }
  &__title {
    margin: 0;
    font-size: 15px;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: t.$space-3;
  padding: t.$space-6;
  border: 1px dashed var(--divider);
  border-radius: t.$radius-lg;
  color: var(--text-faint);
  font-size: 13px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: t.$space-4;
  margin-top: t.$space-6;
}

// 运行时状态是长句而非数字，用正文级别字号并允许换行，避免指标卡把它截断。
.status-runtime {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.status-note {
  font-size: 11px;
  color: var(--text-faint);
}

.status-error {
  width: 100%;
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--error, #{t.$error});
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

// 按内容区宽度收敛栏数，窄栏下 Hero 也收一档字号，避免标题挤成两行。
@container (max-width: 820px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 620px) {
  .status-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero {
    padding: t.$space-5 t.$space-4;

    &__title {
      font-size: 1.6rem;
    }
  }
}
</style>
