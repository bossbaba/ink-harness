<script setup lang="ts">
import { NButton, NTooltip } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";

/**
 * 应用外壳：标题栏 + 左侧导航 + 内容插槽。
 * 这里最关键的是按路由作用域切换侧栏——全局页显示全局菜单，进入某个作品后
 * 换成该作品的二级导航并带「返回工作台」，两者不混排，保证功能页面唯一性。
 * 专注模式下标题栏与侧栏全部隐藏，只留正文和一个悬浮退出按钮。
 * AI 对话面板归写作台所有（作品作用域），外壳不再常驻占位面板。
 */
const app = useAppStore();
const route = useRoute();
const router = useRouter();

// 主题按钮显示的是「切换后」的图标：当前浅色则给出月亮，暗示点下去进入深色；反之给太阳。
const appearanceIcon = computed(() => (app.appearance === "light" ? "☾" : "☀"));
// 专注模式按钮的 tooltip 同样显示「切换后」的动作文案。
const focusTitle = computed(() => (app.focusMode ? "退出专注模式" : "进入专注模式"));

// 全局导航只放真正有全局页面的功能。大纲、写作台、审稿、出版都必须带作品 ID，
// 只在作品内二级导航出现；以前这里的同名禁用占位既无路由也无入口，已移除。
const navItems = [
  { key: "workspace", label: "工作台", icon: "◫", path: "/" },
  { key: "bible", label: "设定库", icon: "▤", path: "/bible" },
  { key: "models", label: "模型管理", icon: "⚙", path: "/models" },
];

// 是否处于作品作用域。进入作品后侧栏要换成该作品的二级导航，
// 全局菜单不再高亮，避免把「全部」和「某一个」混在同一套导航里。
const isProjectRoute = computed(() => /^\/projects\/[^/]+/.test(route.path));
const projectId = computed(() => String(route.params.projectId ?? ""));

// 作品内二级导航：每一项都有对应子路由，不存在禁用占位。
const projectNavItems = [
  { key: "ideation", label: "构思向导", icon: "✷", name: "project-ideation" },
  { key: "bible", label: "设定库", icon: "▤", name: "project-bible" },
  { key: "outline", label: "大纲", icon: "☷", name: "project-outline" },
  { key: "write", label: "写作台", icon: "✎", name: "project-writing" },
  { key: "review", label: "编辑审稿", icon: "◎", name: "project-review" },
  { key: "publish", label: "出版中心", icon: "⇧", name: "project-publish" },
];

/** 全局菜单高亮：只做路径精确相等，不做前缀匹配。 */
function isGlobalActive(path: string): boolean {
  return route.path === path;
}

/** 当前命中的作品内二级导航；未命中时标题只显示「作品」。 */
const activeProjectNav = computed(() => projectNavItems.find((item) => item.name === route.name));

/**
 * 标题栏中间的作用域标签。
 * 在作品路由下按二级路由显示「作品 · 大纲 / 作品 · 设定库」，让用户一眼看出当前是实体内视角；
 * 全局路由下显示命中的菜单名，都没命中（如首页）则回落「工作台」。
 */
const activeLabel = computed(() => {
  if (isProjectRoute.value) {
    return activeProjectNav.value ? `作品 · ${activeProjectNav.value.label}` : "作品";
  }
  return navItems.find((item) => isGlobalActive(item.path))?.label ?? "工作台";
});

function open(item: { path: string }): void {
  void router.push(item.path);
}

const contentRef = ref<HTMLElement | null>(null);

/**
 * 换页后把内容区滚回顶部。
 * 页面本身被 keep-alive 保住了状态，但滚动容器只有这一个：不重置的话，
 * 从很长的审稿报告切到工作台会停在半截空白处。
 */
watch(
  () => route.fullPath,
  async () => {
    await nextTick();
    contentRef.value?.scrollTo({ top: 0 });
  },
);
</script>

<template>
  <div class="shell" :class="{ 'shell--focus': app.focusMode }">
    <header v-if="!app.focusMode" class="titlebar" data-tauri-drag-region>
      <div class="titlebar__brand" data-tauri-drag-region>
        <span class="titlebar__mark">墨</span>
        <span class="titlebar__name serif">INK-HARNESS</span>
      </div>
      <div class="titlebar__center" data-tauri-drag-region>
        <span class="titlebar__project">{{ activeLabel }}</span>
      </div>
      <div class="titlebar__actions">
        <NTooltip>
          <template #trigger>
            <NButton quaternary size="small" @click="app.toggleAppearance()">
              {{ appearanceIcon }}
            </NButton>
          </template>
          {{ app.appearance === "light" ? "切换到深色" : "切换到浅色" }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NButton quaternary size="small" @click="app.toggleFocusMode()">◎</NButton>
          </template>
          {{ focusTitle }}
        </NTooltip>
      </div>
    </header>

    <div class="body">
      <aside v-if="!app.focusMode" class="sidebar">
        <template v-if="isProjectRoute">
          <RouterLink to="/" class="nav__item nav__back">
            <span class="nav__icon">←</span>
            <span class="nav__label">返回工作台</span>
          </RouterLink>
          <div class="sidebar__section">当前作品</div>
          <nav class="nav">
            <RouterLink
              v-for="item in projectNavItems"
              :key="item.key"
              :to="{ name: item.name, params: { projectId } }"
              class="nav__item"
              :class="{ 'nav__item--active': route.name === item.name }"
            >
              <span class="nav__icon">{{ item.icon }}</span>
              <span class="nav__label">{{ item.label }}</span>
            </RouterLink>
          </nav>
        </template>
        <nav v-else class="nav">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="nav__item"
            :class="{ 'nav__item--active': isGlobalActive(item.path) }"
            type="button"
            :title="item.label"
            @click="open(item)"
          >
            <span class="nav__icon">{{ item.icon }}</span>
            <span class="nav__label">{{ item.label }}</span>
          </button>
        </nav>
        <div class="sidebar__footer">
          <NButton quaternary size="tiny" block @click="app.toggleFocusMode()">专注模式</NButton>
        </div>
      </aside>

      <main ref="contentRef" class="content">
        <slot />
      </main>
    </div>

    <button
      v-if="app.focusMode"
      class="focus-exit"
      type="button"
      title="退出专注模式 (Esc)"
      @click="app.toggleFocusMode()"
    >
      ◎
    </button>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-app);
  color: var(--text-primary);
}

.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 38px;
  padding: 0 t.$space-4;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-surface);
  user-select: none;

  &__brand {
    display: flex;
    align-items: center;
    gap: t.$space-2;
  }
  &__mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    font-family: t.$font-serif;
    font-size: 12px;
  }
  &__name {
    font-size: 13px;
    letter-spacing: 0.14em;
  }
  &__center {
    justify-self: center;
  }
  &__project {
    font-size: 12px;
    color: var(--text-faint);
  }
  &__actions {
    justify-self: end;
    display: flex;
    gap: t.$space-1;
  }
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  flex-shrink: 0;
  padding: t.$space-3 t.$space-2;
  border-right: 1px solid var(--divider);
  background: var(--bg-sunken);

  &__section {
    margin: t.$space-2 t.$space-3 t.$space-1;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--text-faint);
  }

  &__footer {
    margin-top: auto;
    padding: t.$space-2;
  }
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;

  &__item {
    display: flex;
    align-items: center;
    gap: t.$space-3;
    width: 100%;
    padding: t.$space-2 t.$space-3;
    border: none;
    border-radius: t.$radius-sm;
    background: transparent;
    color: var(--text-soft);
    font-size: 13px;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background t.$duration t.$ease, color t.$duration t.$ease;

    &:hover {
      background: rgba(128, 128, 128, 0.1);
      color: var(--text-primary);
    }

    &--active {
      background: var(--bg-surface);
      color: var(--accent);
      font-weight: 600;
    }

  }

  &__icon {
    width: 18px;
    text-align: center;
    font-size: 14px;
  }

  &__back {
    margin-bottom: t.$space-2;
  }
}

.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.focus-exit {
  position: absolute;
  top: t.$space-3;
  right: t.$space-3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--divider);
  border-radius: 50%;
  background: var(--bg-surface);
  color: var(--text-soft);
  font-size: 14px;
  cursor: pointer;
  opacity: 0.35;
  transition: opacity t.$duration t.$ease;

  &:hover {
    opacity: 1;
  }
}
</style>
