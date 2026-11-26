<script setup lang="ts">
import { NButton, NTag, NTooltip } from "naive-ui";
import { useRouter } from "vue-router";
import AppEmpty from "@/components/common/AppEmpty.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import LoadingState from "@/components/common/LoadingState.vue";
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
  projectsLoading,
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
          <NButton type="primary" size="small" @click="showNew = true">
            <AppIcon name="plus" :size="16" />
            新建作品
          </NButton>
          <span class="hero__note">本地优先 · 数据不上云</span>
        </div>
      </div>
      <!-- 设计稿右侧的文档插画：纯装饰，不参与交互；用 SVG 保证任意缩放下都清晰。 -->
      <div class="hero__art" aria-hidden="true">
        <!-- 插画的填充全部走主题变量，暗色模式跟着换色，不在这里硬编码设计稿色值。 -->
        <svg viewBox="0 0 132 96" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>文档完成示意</title>
          <!-- 用 style 而不是 SVG 呈现属性承载 var()，兼容 Tauri 使用的 WebKit 内核。 -->
          <rect x="14" y="10" width="104" height="76" rx="8" style="fill: var(--accent-soft)" />
          <rect
            x="22"
            y="4"
            width="104"
            height="76"
            rx="8"
            style="fill: var(--bg-surface); stroke: var(--border)"
          />
          <rect x="34" y="20" width="40" height="5" rx="2.5" style="fill: var(--accent)" />
          <rect x="34" y="34" width="72" height="4" rx="2" style="fill: var(--border)" />
          <rect x="34" y="44" width="60" height="4" rx="2" style="fill: var(--border)" />
          <rect x="34" y="54" width="66" height="4" rx="2" style="fill: var(--border)" />
          <rect x="34" y="64" width="44" height="4" rx="2" style="fill: var(--border)" />
          <circle cx="104" cy="70" r="17" style="fill: var(--accent)" />
          <path
            d="m97 70 5 5 9-10"
            stroke="#fff"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">
          我的作品
          <NTag class="count" size="tiny" round :bordered="false">{{ projects.length }}</NTag>
        </h2>
        <p class="section__hint">本地作品 · 点击卡片进入对应创作环节</p>
      </div>
      <LoadingState v-if="projectsLoading" text="正在载入作品…" />
      <div v-else-if="projects.length === 0" class="empty">
        <AppEmpty
          icon="workspace"
          title="还没有作品"
          description="创建第一部作品，构思、大纲与写作都会在这里展开。"
          action-label="新建作品"
          @action="showNew = true"
        />
      </div>
      <div v-else class="project-grid">
        <article v-for="p in projects" :key="p.id" class="project-card">
          <!-- 设计稿卡片头部：42px 图标 + 17px 作品名 + 状态标签 -->
          <div class="project-card__head">
            <span class="project-card__icon" aria-hidden="true">
              <AppIcon name="workspace" :size="22" />
            </span>
            <div class="project-card__heading">
              <h3 class="project-card__title serif">{{ p.title }}</h3>
              <p class="project-card__premise">{{ p.premise || "暂无梗概" }}</p>
            </div>
            <NTag size="small" :bordered="false" type="success" class="project-card__status">
              {{ PROJECT_STATUS_LABEL[p.status] }}
            </NTag>
          </div>
          <!-- 设计稿入口行：左侧类型标签 + 右侧六个绿字文字链接（非按钮） -->
          <div class="project-card__entry">
            <span class="project-card__genre">{{ p.genre || "未分类" }}</span>
            <nav class="project-card__actions" aria-label="作品创作入口">
              <button type="button" @click="openIdeation(p.id)">构思向导 <span>›</span></button>
              <button type="button" @click="openOutline(p.id)">进入大纲 <span>›</span></button>
              <button type="button" @click="openWriting(p.id)">进入写作台 <span>›</span></button>
              <button type="button" @click="openBible(p.id)">进入设定库 <span>›</span></button>
              <button type="button" @click="openPublish(p.id)">出版中心 <span>›</span></button>
              <button type="button" @click="openWorkflow(p.id)">创作工作流 <span>›</span></button>
            </nav>
          </div>
        </article>
      </div>
    </section>

    <section class="status-grid">
      <StatCard variant="status" label="本地运行时">
        <span class="status-runtime">{{ backend }}</span>
      </StatCard>
      <StatCard variant="status" label="Ollama 服务">
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
            :loading="ollamaStarting"
            @click="startOllama"
          >
            启动本地模型 →
          </NButton>
          <NButton size="small" quaternary @click="openModels">配置模型 →</NButton>
        </template>
      </StatCard>
      <StatCard
        variant="status"
        label="主题"
        :value="app.appearance === 'light' ? '浅色 · 纸墨' : '深色 · 夜读'"
      />
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
// 作品卡片样式按设计稿拆到同目录片段，scoped 作用域仍由本页提供。
@use "./WorkspaceView.projectCard";

.workspace {
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
  margin: 0 auto;
  // 设计稿主内容区四边 padding 均为 32px（节点 3:236）。
  padding: t.$space-6;
  // 页面根必须声明容器：卡片栅格按「内容区宽度」而不是窗口宽度决定列数，
  // 否则侧栏/专注模式切换时会算出错误的列数。
  container-type: inline-size;
}

// 首屏 Hero：用一张带主色环境光的面板承接标题与主操作，比居中裸标题更有分量。
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: t.$space-6;
  overflow: hidden;
  // 设计稿节点 3:237：Hero 卡片 236px 高、四边内边距 36px。
  min-height: 236px;
  padding: 36px;
  border: 1px solid var(--divider);
  border-radius: t.$radius-xl;
  // 设计稿 3:237：卡面是纯净纸色，纵深只由阴影承担，不叠环境光渐变。
  background: var(--bg-surface);
  box-shadow: t.$shadow-card;

  &__content {
    position: relative;
    z-index: 1;
    min-width: 0;
    max-width: 640px;
  }

  // 右侧文档插画：桌面端占位，窄容器下隐藏，避免挤压标题。
  &__art {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    // 设计稿插画内容 240×140，放在 Hero 右侧独立留白里。
    width: 240px;

    svg {
      display: block;
      width: 100%;
      height: auto;
    }
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
    // 设计稿 3:240 主标题 38px 衬线，与下方说明保持 12px 间距。
    font-size: 2.375rem;
    font-weight: 600;
    line-height: 1.45;
    letter-spacing: 0.02em;
    color: var(--text-primary);
  }
  &__subtitle {
    margin: t.$space-3 0 t.$space-5;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-muted, #{t.$ink-muted});
  }
  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-3;

    // 设计稿 3:243：主按钮 40px 高、13px 字，与右侧说明文字拉开距离。
    :deep(.n-button) {
      height: 40px;
      padding: 0 t.$space-4;
      font-size: 13px;
    }

    :deep(.n-button__content) {
      gap: t.$space-2;
    }
  }
  &__note {
    font-size: 11px;
    color: var(--text-faint);
  }
}

.section {
  // 设计稿主内容区区块间距 20px。
  margin-top: t.$space-5;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: t.$space-4;
    margin-bottom: t.$space-4;
  }

  // 设计稿在段落右侧给一句轻提示，解释卡片的用途，避免用户不知道入口在哪。
  &__hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint);
  }

  &__title {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    margin: 0;
    // 设计稿 3:261：区块标题 15px，与 3px 主色竖标组成段落起点。
    font-size: 15px;
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
  // 设计稿状态卡组高 148px、与上方区块间距 20px。
  margin-top: t.$space-5;
  min-height: 148px;
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

  // 窄内容区让六个入口折行，保持每个链接可读。
  .project-card {
    &__actions {
      flex-wrap: wrap;
      justify-content: flex-start;
      row-gap: t.$space-1;
    }
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

    &__art {
      display: none;
    }
  }

  .section__hint {
    display: none;
  }
}
</style>
