<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "@/components/common/AppIcon.vue";
import { projectService } from "@/services/projectService";
import { useProjectStore } from "@/stores/project";

const route = useRoute();
const projectStore = useProjectStore();
// 作品作用域父路由的入口：ID 缺失或作品不存在时只显示错误，不渲染子页面。
// 外壳本身会被 keep-alive 缓存，projectId 必须跟着路由实时变——否则从一个作品
// 跳到另一个作品时，面包屑与子页面的作用域都还是上一个作品的。
const projectId = computed(() => String(route.params.projectId ?? ""));
// 作品本身放在全局 store：子页面（大纲/写作台/审稿）都是同一份数据，
// 一处保存后其它页面的标题与状态立刻同步。
const project = storeToRefs(projectStore).current;
const error = ref("");

async function loadProject(): Promise<void> {
  const id = projectId.value;
  // 离开作品去全局页时路由里没有 projectId：这里保持现状，
  // 一旦把 project 清空，v-if 会把缓存的子页面整棵销毁，写作台的编辑状态就白存了。
  if (!id) return;
  // 从别处回到同一个作品：沿用已加载的作品与缓存，不重新挂载子页面。
  if (project.value?.id === id) return;
  // 真正切换作品时才清空，避免新作品页面带着上一篇的标题渲染。
  projectStore.clear();
  error.value = "";
  try {
    projectStore.set(await projectService.get(id));
    if (!project.value) error.value = "作品不存在或已删除。";
  } catch (err) {
    error.value = `读取作品失败：${String(err)}`;
  }
}

watch(projectId, loadProject, { immediate: true });
</script>

<template>
  <div class="project-shell">
    <!-- 专注模式没有标题栏，这一行兼作窗口拖拽区；面包屑链接未标记，仍可正常点击。 -->
    <header class="project-shell__header" data-tauri-drag-region>
      <nav class="project-shell__crumb" aria-label="面包屑">
        <RouterLink to="/" class="project-shell__crumb-link">
          <AppIcon name="chevron-left" :size="12" />
          <span>工作台</span>
        </RouterLink>
        <AppIcon class="project-shell__crumb-sep" name="chevron-right" :size="10" />
        <span class="project-shell__crumb-current">{{ project?.title ?? "作品" }}</span>
      </nav>
    </header>

    <div class="project-shell__body">
      <p v-if="error" class="project-shell__error" role="alert">{{ error }}</p>
      <!--
        作品内的子页面各缓存一份：同一作品里切页保留状态，换作品时重新挂载。
        key 必须同时带上路由名：KeepAlive 只按 key 找缓存，若只用 projectId，
        不同页面（设定库/大纲/写作台）会共用同一条缓存，切页时会渲染出上一个页面。
      -->
      <RouterView v-else-if="project" v-slot="{ Component }">
        <!--
          上限 6：key 带 projectId，换作品时旧实例不会被复用；
          没有上限的话，切几个作品的几个页面就会把监听器与整份章节数据一直留在内存里。
        -->
        <KeepAlive :max="6">
          <component :is="Component" :key="`${projectId}:${String(route.name ?? '')}`" />
        </KeepAlive>
      </RouterView>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/mixins" as m;
@use "../styles/tokens" as t;

// 外壳撑满内容区高度：写作台这类「编辑区自己滚动」的页面需要确定的 100% 高度，
// 其余页面（大纲/设定库）仍按内容自然增长，由外层 .content 统一滚动。
.project-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-app);

  &__header {
    display: flex;
    flex: none;
    align-items: center;
    padding: t.$space-3 t.$space-6;
    // 专注模式下没有标题栏，macOS 红绿灯会直接压在面包屑上；
    // --page-header-inset 由 AppShell 仅在「专注 + macOS」时下发，普通模式回落到 32px。
    padding-left: var(--page-header-inset, #{t.$space-6});
    // 设计稿把面包屑当作正文眉标而非独立工具条：去掉分隔线，让它与标题连成一体。
    padding-top: t.$space-5;
    padding-bottom: t.$space-2;
  }

  // 这里只负责「撑满剩余高度」，不能设成 flex 容器：
  // 各二级页用 `margin: 0 auto` 居中，父级一旦是 flex 容器，auto margin 会让
  // 子项退化成 shrink-to-fit（宽变窄、正文一字一行），写作台要的 100% 高度也会失效。
  &__body {
    flex: 1;
    min-height: 0;
  }

  // 面包屑：父级用可点的轻量胶囊，当前作品加粗并跟随主题前景色。
  // 11px 的灰字在长页面顶部几乎看不清，这里统一到 12px 并留出悬浮反馈。
  &__crumb {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    font-size: 12px;
    line-height: 1;
  }

  &__crumb-link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 7px 4px 5px;
    border-radius: t.$radius-sm;
    color: var(--text-soft, #{t.$ink-soft});
    text-decoration: none;
    transition:
      background 140ms t.$ease,
      color 140ms t.$ease;

    &:hover {
      background: var(--bg-hover, #{t.$bg-hover});
      color: var(--text-primary, #{t.$ink});
    }
  }

  &__crumb-sep {
    margin: 0 1px;
    color: var(--text-faint, #{t.$ink-faint});
    opacity: 0.6;
  }

  &__crumb-current {
    @include m.ellipsis;
    padding: 4px 4px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__error {
    margin: t.$space-6;
    font-size: 12px;
    color: var(--error, #{t.$error});
  }
}
</style>
