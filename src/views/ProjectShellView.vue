<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { projectService } from "@/services/projectService";
import type { Project } from "@/types";

const route = useRoute();
// 作品作用域父路由的入口：ID 缺失或作品不存在时只显示错误，不渲染子页面。
const projectId = String(route.params.projectId ?? "");
const project = ref<Project | null>(null);
const error = ref("");

onMounted(async () => {
  // 没有作品 ID 就直接停止，避免子页面拿到空作用域去取全局数据。
  if (!projectId) {
    error.value = "缺少作品 ID。";
    return;
  }
  try {
    project.value = await projectService.get(projectId);
    if (!project.value) error.value = "作品不存在或已删除。";
  } catch (err) {
    error.value = `读取作品失败：${String(err)}`;
  }
});
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
      <RouterView v-else-if="project" />
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
