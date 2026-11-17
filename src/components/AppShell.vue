<script setup lang="ts">
import { NButton, NTooltip } from "naive-ui";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";

/**
 * 应用外壳：标题栏 + 左侧导航 + 右侧 AI 面板 + 内容插槽。
 * 这里最关键的是按路由作用域切换侧栏——全局页显示全局菜单，进入某个作品后
 * 换成该作品的二级导航并带「返回工作台」，两者不混排，保证功能页面唯一性。
 * 专注模式下标题栏、侧栏、AI 面板全部隐藏，只留正文和一个悬浮退出按钮。
 */
const app = useAppStore();
const route = useRoute();
const router = useRouter();

// 主题按钮显示的是「切换后」的图标：当前浅色则给出月亮，暗示点下去进入深色；反之给太阳。
const appearanceIcon = computed(() => (app.appearance === "light" ? "☾" : "☀"));
// 专注模式按钮的 tooltip 同样显示「切换后」的动作文案。
const focusTitle = computed(() => (app.focusMode ? "退出专注模式" : "进入专注模式"));

// 全局导航。path 为空的是尚未开放的模块，渲染为禁用态，不参与路由跳转。
const navItems = [
  { key: "workspace", label: "工作台", icon: "◫", path: "/" },
  { key: "outline", label: "大纲", icon: "☷", path: "" },
  { key: "bible", label: "设定库", icon: "▤", path: "/bible" },
  { key: "write", label: "写作台", icon: "✎", path: "" },
  { key: "review", label: "编辑审稿", icon: "◎", path: "" },
  { key: "publish", label: "出版中心", icon: "⇧", path: "" },
  { key: "models", label: "模型管理", icon: "⚙", path: "/models" },
];

// 是否处于作品作用域。进入作品后侧栏要换成该作品的二级导航，
// 全局菜单不再高亮，避免把「全部」和「某一个」混在同一套导航里。
const isProjectRoute = computed(() => /^\/projects\/[^/]+/.test(route.path));
const projectId = computed(() => String(route.params.projectId ?? ""));

// 作品内二级导航。name 为空的模块尚未开放，只作占位。
const projectNavItems = [
  { key: "ideation", label: "构思向导", icon: "✷", name: "project-ideation" },
  { key: "bible", label: "设定库", icon: "▤", name: "project-bible" },
  { key: "outline", label: "大纲", icon: "☷", name: "project-outline" },
  { key: "write", label: "写作台", icon: "✎", name: "project-writing" },
  { key: "review", label: "编辑审稿", icon: "◎", name: "" },
];

/**
 * 判断某个全局菜单项是否是当前页。
 * 必须排除 path 为空的占位项：否则 /projects/... 之类的路径若与空串比较，
 * 会错误地把「大纲」等未开放项高亮。这里用精确相等，不做前缀匹配。
 */
function isGlobalActive(path: string): boolean {
  return path !== "" && route.path === path;
}

/** 当前命中的作品内二级导航；未命中时标题只显示「作品」。 */
const activeProjectNav = computed(() =>
  projectNavItems.find((item) => item.name !== "" && item.name === route.name),
);

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
  // 未开放模块的 path 为空，点击时不做跳转。
  if (item.path) void router.push(item.path);
}
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
            <template v-for="item in projectNavItems" :key="item.key">
              <RouterLink
                v-if="item.name"
                :to="{ name: item.name, params: { projectId } }"
                class="nav__item"
                :class="{ 'nav__item--active': route.name === item.name }"
              >
                <span class="nav__icon">{{ item.icon }}</span>
                <span class="nav__label">{{ item.label }}</span>
              </RouterLink>
              <button
                v-else
                class="nav__item nav__item--disabled"
                type="button"
                disabled
                :title="`${item.label}：即将推出`"
              >
                <span class="nav__icon">{{ item.icon }}</span>
                <span class="nav__label">{{ item.label }}</span>
              </button>
            </template>
          </nav>
        </template>
        <nav v-else class="nav">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="nav__item"
            :class="{
              'nav__item--active': isGlobalActive(item.path),
              'nav__item--disabled': !item.path,
            }"
            type="button"
            :disabled="!item.path"
            :title="item.path ? item.label : '即将推出'"
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

      <main class="content">
        <slot />
      </main>

      <aside v-if="app.copilotOpen && !app.focusMode" class="copilot">
        <div class="copilot__header">
          <span class="copilot__title">AI 助手</span>
          <span class="copilot__status">未连接</span>
        </div>
        <div class="copilot__placeholder">
          <p>选中文本后可用 AI 续写、改写与润色。</p>
          <p class="copilot__hint">模型网关已就绪 · 配置模型后即可对话</p>
        </div>
      </aside>
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

    &--disabled {
      opacity: 0.4;
      cursor: not-allowed;
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

.copilot {
  display: flex;
  flex-direction: column;
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--divider);
  background: var(--bg-surface);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: t.$space-3 t.$space-4;
    border-bottom: 1px solid var(--divider);
  }
  &__title {
    font-size: 13px;
    font-weight: 600;
  }
  &__status {
    font-size: 11px;
    color: var(--text-faint);
  }
  &__placeholder {
    flex: 1;
    padding: t.$space-5 t.$space-4;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-soft);
  }
  &__hint {
    margin-top: t.$space-4;
    font-size: 11px;
    color: var(--text-faint);
  }
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
