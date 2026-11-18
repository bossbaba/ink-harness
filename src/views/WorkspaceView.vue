<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NTag } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { tauriApi } from "@/api/tauri";
import NewProjectDialog from "@/components/NewProjectDialog.vue";
import { useOllamaControl } from "@/composables/useOllamaControl";
import { projectService } from "@/services/projectService";
import { useAppStore } from "@/stores/app";
import { type DatabaseInfo, PROJECT_STATUS_LABEL, type Project } from "@/types";
import { onReactivated } from "@/utils/lifecycle";

const app = useAppStore();
const router = useRouter();
// 页面状态：作品列表是主体，其余三项只服务于顶部/底部的状态卡片。
const backend = ref("检测中…"); // 后端 ping 结果文案，初始值先给「检测中」
// 本地模型状态交给共享组合式函数，工作台可以直接把服务拉起来，不用让用户去终端执行命令。
const {
  status: ollama,
  starting: ollamaStarting,
  error: ollamaError,
  refresh: refreshOllama,
  start: startOllama,
} = useOllamaControl();
const ollamaRunning = computed(() => ollama.value?.running ?? false);
const ollamaModels = computed(() => ollama.value?.models ?? []);
const projects = ref<Project[]>([]); // 作品卡片数据
const dbInfo = ref<DatabaseInfo | null>(null); // 数据库路径，null 表示没取到，模板据此不显示
const showNew = ref(false); // 新建作品弹窗开关
const error = ref(""); // 作品列表读取失败文案

// 工作台：展示作品卡片，以及后端、Ollama、主题等本地运行状态。
// 这些状态探测失败都不影响页面主体，各自单独兜底。
async function loadProjects() {
  try {
    projects.value = await projectService.list();
  } catch (err) {
    error.value = `读取作品失败：${String(err)}`;
  }
}

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

/**
 * 首屏初始化：把主题同步到 document，再并行探测本地运行时环境。
 * 三个探测（后端、Ollama、数据库路径）彼此独立且都能失败，所以各自 try/catch，
 * 任何一个挂掉都只让对应状态卡片降级显示，绝不阻断作品列表这个主体内容。
 */
onMounted(async () => {
  app.initAppearance();
  // 后端探测失败也只影响状态卡片，不阻断作品列表加载。
  try {
    backend.value = await tauriApi.ping();
  } catch (err) {
    backend.value = `后端未就绪：${String(err)}`;
  }
  // 检测失败时状态保持 null，界面上只显示「未运行」，不弹错误打扰首屏。
  await refreshOllama();
  await loadProjects();
  try {
    dbInfo.value = await projectService.databaseInfo();
  } catch {
    dbInfo.value = null;
  }
});

// 页面被 keep-alive 缓存后 onMounted 只跑一次：从作品里回来时补刷作品列表，
// 否则新建/改名/删除的作品在工作台上看不到变化。
onReactivated(() => void loadProjects());
</script>

<template>
  <div class="workspace">
    <section class="hero">
      <h1 class="hero__title serif">开始你的下一部作品</h1>
      <p class="hero__subtitle">从构思到出版，AI 全程辅助，数据留在你的电脑。</p>
      <div class="hero__actions">
        <MacButton variant="prominent" @click="showNew = true">新建作品</MacButton>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="section">
      <h2 class="section__title">我的作品 <span class="count">{{ projects.length }}</span></h2>
      <div v-if="projects.length === 0" class="empty">
        <p>还没有作品。点击「新建作品」开始。</p>
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
            <button class="project-card__open" type="button" @click="openIdeation(p.id)">
              构思向导 →
            </button>
            <button class="project-card__open" type="button" @click="openOutline(p.id)">
              进入大纲 →
            </button>
            <button class="project-card__open" type="button" @click="openWriting(p.id)">
              进入写作台 →
            </button>
            <button class="project-card__open" type="button" @click="openBible(p.id)">
              进入设定库 →
            </button>
            <button class="project-card__open" type="button" @click="openPublish(p.id)">
              出版中心 →
            </button>
            <button class="project-card__open" type="button" @click="openWorkflow(p.id)">
              创作工作流 →
            </button>
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
          <button
            v-if="!ollamaRunning"
            class="card__link"
            type="button"
            :disabled="ollamaStarting"
            @click="startOllama"
          >
            {{ ollamaStarting ? "启动中…" : "启动本地模型 →" }}
          </button>
          <button class="card__link" type="button" @click="openModels">配置模型 →</button>
        </div>
      </div>
      <div class="card">
        <div class="card__label">主题</div>
        <div class="card__value">
          {{ app.appearance === "light" ? "浅色 · 纸墨" : "深色 · 夜读" }}
        </div>
      </div>
    </section>

    <p v-if="dbInfo" class="db-path" :title="dbInfo.path">作品库：{{ dbInfo.path }}</p>

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

.count {
  display: inline-block;
  margin-left: t.$space-2;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-sunken);
  font-size: 11px;
  color: var(--text-faint);
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
    gap: t.$space-2;
    margin-top: t.$space-3;
  }
  &__open {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    // 单个按钮的文字与箭头始终同一行，也不被 flex 压缩宽度。
    white-space: nowrap;
    flex-shrink: 0;

    &:hover {
      text-decoration: underline;
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
    gap: t.$space-3;
    margin-top: t.$space-2;
  }
  &__link {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;

    &:disabled {
      color: var(--text-faint);
      cursor: progress;
    }
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
