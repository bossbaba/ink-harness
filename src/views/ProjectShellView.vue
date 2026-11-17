<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { projectService } from "@/services/projectService";
import type { Project } from "@/types";

const route = useRoute();
// 作品作用域父路由的入口：ID 缺失或作品不存在时只显示错误，不渲染子页面。
// 外壳本身会被 keep-alive 缓存，projectId 必须跟着路由实时变——否则从一个作品
// 跳到另一个作品时，面包屑与子页面的作用域都还是上一个作品的。
const projectId = computed(() => String(route.params.projectId ?? ""));
const project = ref<Project | null>(null);
const error = ref("");

async function loadProject(): Promise<void> {
  const id = projectId.value;
  // 离开作品去全局页时路由里没有 projectId：这里保持现状，
  // 一旦把 project 清空，v-if 会把缓存的子页面整棵销毁，写作台的编辑状态就白存了。
  if (!id) return;
  // 从别处回到同一个作品：沿用已加载的作品与缓存，不重新挂载子页面。
  if (project.value?.id === id) return;
  // 真正切换作品时才清空，避免新作品页面带着上一篇的标题渲染。
  project.value = null;
  error.value = "";
  try {
    project.value = await projectService.get(id);
    if (!project.value) error.value = "作品不存在或已删除。";
  } catch (err) {
    error.value = `读取作品失败：${String(err)}`;
  }
}

watch(projectId, loadProject, { immediate: true });
</script>

<template>
  <div class="project-shell">
    <header class="project-shell__header">
      <div class="project-shell__crumb">
        <RouterLink to="/">工作台</RouterLink>
        <span>/</span>
        <span>{{ project?.title ?? "作品" }}</span>
      </div>
    </header>

    <div class="project-shell__body">
      <p v-if="error" class="project-shell__error">{{ error }}</p>
      <!--
        作品内的子页面各缓存一份：同一作品里切页保留状态，换作品时重新挂载。
        key 必须同时带上路由名：KeepAlive 只按 key 找缓存，若只用 projectId，
        不同页面（设定库/大纲/写作台）会共用同一条缓存，切页时会渲染出上一个页面。
      -->
      <RouterView v-else-if="project" v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" :key="`${projectId}:${String(route.name ?? '')}`" />
        </KeepAlive>
      </RouterView>
    </div>
  </div>
</template>

<style scoped lang="scss">
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
    border-bottom: 1px solid var(--divider, #{t.$divider});
  }

  // 这里只负责「撑满剩余高度」，不能设成 flex 容器：
  // 各二级页用 `margin: 0 auto` 居中，父级一旦是 flex 容器，auto margin 会让
  // 子项退化成 shrink-to-fit（宽变窄、正文一字一行），写作台要的 100% 高度也会失效。
  &__body {
    flex: 1;
    min-height: 0;
  }

  &__crumb {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});

    a {
      color: inherit;
      text-decoration: none;

      &:hover {
        color: var(--accent, #{t.$accent});
      }
    }
  }

  &__error {
    margin: t.$space-6;
    font-size: 12px;
    color: var(--error, #{t.$error});
  }
}
</style>
