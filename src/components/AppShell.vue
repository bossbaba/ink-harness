<script setup lang="ts">
import { NButton, NTag, NTooltip } from "naive-ui";
import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GLOBAL_NAV as navItems, PROJECT_NAV as projectNavItems } from "@/app/router/nav";
import AppIcon from "@/components/common/AppIcon.vue";
import { useCurrentModel } from "@/composables/useCurrentModel";
import { useAppStore } from "@/stores/app";
import { useProjectStore } from "@/stores/project";

/**
 * 应用外壳：标题栏 + 左侧导航 + 内容插槽。
 * 这里最关键的是按路由作用域切换侧栏——全局页显示全局菜单，进入某个作品后
 * 换成该作品的二级导航并带「返回工作台」，两者不混排，保证功能页面唯一性。
 * 专注模式下标题栏与侧栏全部隐藏，只留正文和一个毛玻璃悬浮退出按钮。
 * AI 对话面板归写作台所有（作品作用域），外壳不再常驻占位面板。
 */
const app = useAppStore();
const route = useRoute();
const router = useRouter();
// 顶栏的「当前模型」直接读路由选择结果，用户换默认模型/启停 Provider 后自动更新。
const { currentModelLabel, currentModelDetail } = useCurrentModel();

// 主题按钮显示的是「切换后」的图标：当前浅色则给出月亮，暗示点下去进入深色；反之给太阳。
const appearanceIcon = computed(() => (app.appearance === "light" ? "moon" : "sun"));
// 专注模式按钮的 tooltip 同样显示「切换后」的动作文案。
const focusTitle = computed(() => (app.focusMode ? "退出专注模式" : "进入专注模式"));

/**
 * macOS 上标题栏用 Overlay 样式，系统红绿灯直接画在我们的标题栏里。
 * 这时左侧要给红绿灯留出安全区，否则「墨」标会压在按钮上；浏览器预览没有红绿灯。
 */
const hasTrafficLights = (() => {
  if (typeof window === "undefined") return false;
  const isTauri = "__TAURI_INTERNALS__" in window;
  return isTauri && /Mac/i.test(navigator.userAgent);
})();

// 导航表在 @/app/router/nav 里与路由同源：改一处即可，菜单不会指向不存在的页面。
// 是否处于作品作用域。进入作品后侧栏要换成该作品的二级导航，
// 全局菜单不再高亮，避免把「全部」和「某一个」混在同一套导航里。
const isProjectRoute = computed(() => /^\/projects\/[^/]+/.test(route.path));
const projectId = computed(() => String(route.params.projectId ?? ""));

// 作品名来自全局 store：子页面保存后标题立刻同步，不再显示「作品 · 大纲」这种泛称。
const projectStore = useProjectStore();
const project = storeToRefs(projectStore).current;

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
    // 用真实作品名替代「作品」占位：用户在多部作品间切换时靠这行区分。
    const scope = project.value?.title ?? "作品";
    return activeProjectNav.value ? `${scope} · ${activeProjectNav.value.label}` : scope;
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
    <header
      v-if="!app.focusMode"
      class="titlebar"
      :class="{ 'titlebar--lights': hasTrafficLights }"
      data-tauri-drag-region
    >
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
            <NTag
              class="model-badge"
              size="small"
              :bordered="false"
              round
              @click="router.push('/models')"
            >
              {{ currentModelLabel }}
            </NTag>
          </template>
          {{ currentModelDetail }}（点击前往模型管理）
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NButton quaternary size="small" class="tool-button" @click="app.toggleAppearance()">
              <AppIcon :name="appearanceIcon" :size="16" />
            </NButton>
          </template>
          {{ app.appearance === "light" ? "切换到深色" : "切换到浅色" }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NButton quaternary size="small" class="tool-button" @click="app.toggleFocusMode()">
              <AppIcon name="focus" :size="16" />
            </NButton>
          </template>
          {{ focusTitle }}
        </NTooltip>
      </div>
    </header>

    <div class="body">
      <aside v-if="!app.focusMode" class="sidebar">
        <template v-if="isProjectRoute">
          <RouterLink to="/" class="nav__item nav__back">
            <AppIcon name="chevron-left" :size="15" />
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
              <AppIcon class="nav__icon" :name="item.icon" :size="16" />
              <span class="nav__label">{{ item.label }}</span>
            </RouterLink>
          </nav>
        </template>
        <nav v-else class="nav">
          <!-- 侧栏导航项用 NButton text 变体，保留原有列表式排版；文案已可见，不再重复 title。 -->
          <NButton
            v-for="item in navItems"
            :key="item.key"
            text
            block
            class="nav__item"
            :class="{ 'nav__item--active': isGlobalActive(item.path) }"
            @click="open(item)"
          >
            <AppIcon class="nav__icon" :name="item.icon" :size="16" />
            <span class="nav__label">{{ item.label }}</span>
          </NButton>
        </nav>
        <NButton text block class="nav__item nav__focus" @click="app.toggleFocusMode()">
          <AppIcon class="nav__icon" name="focus" :size="16" />
          <span class="nav__label">专注模式</span>
        </NButton>
      </aside>

      <main ref="contentRef" class="content">
        <slot />
      </main>
    </div>

    <!-- 悬浮退出按钮用 NTooltip 承载快捷提示，避免浏览器原生 title 的延迟与样式不一致。 -->
    <NTooltip v-if="app.focusMode">
      <template #trigger>
        <NButton
          circle
          quaternary
          class="focus-exit"
          aria-label="退出专注模式 (Esc)"
          @click="app.toggleFocusMode()"
        >
          <AppIcon name="focus" :size="15" />
        </NButton>
      </template>
      退出专注模式 (Esc)
    </NTooltip>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-app);
  color: var(--text-primary);
}

.titlebar {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 44px;
  padding: 0 t.$space-3;
  border-bottom: 1px solid var(--divider);
  // 先给一个实色兜底，再叠毛玻璃：Webview 不支持 color-mix 时也不会露出背景。
  background: var(--bg-surface);
  background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  user-select: none;

  // macOS 红绿灯占据左上角约 72px，避免品牌标识和按钮被压住。
  &--lights {
    padding-left: 80px;
  }

  &__brand {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }
  &__mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      0 1px 2px rgba(0, 0, 0, 0.12);
    font-family: t.$font-serif;
    font-size: 12px;
  }
  &__name {
    @include m.ellipsis;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
  }
  &__center {
    justify-self: center;
    min-width: 0;
  }
  &__project {
    @include m.ellipsis;
    display: block;
    max-width: 42vw;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-soft);
  }
  &__actions {
    justify-self: end;
    display: flex;
    gap: 2px;
  }
}

.tool-button {
  color: var(--text-soft);
}

// 顶栏当前模型标签：可点击跳转模型管理，光标与悬浮反馈要明确。
.model-badge {
  max-width: 200px;
  cursor: pointer;
  color: var(--text-soft);
  background: var(--bg-sunken);

  &:hover {
    color: var(--accent);
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
  padding: t.$space-2;
  border-right: 1px solid var(--divider);
  background: var(--bg-sunken);
  user-select: none;

  &__section {
    margin: t.$space-3 t.$space-3 t.$space-1;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;

  // 双写类名是为了压过 NButton 注入的 padding/字号样式，保留侧栏列表项的原生排版。
  &__item.nav__item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 30px;
    padding: t.$space-2 t.$space-3;
    border: none;
    border-radius: t.$radius-sm;
    background: transparent;
    color: var(--text-soft);
    font-size: 13px;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    white-space: normal;
    transition: background 140ms t.$ease, color 140ms t.$ease;

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    // source-list 选中态：淡色填充 + 强调色文字，比整块白底加粗更接近 macOS。
    &--active,
    &.nav__item--active {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 500;
    }

    // NButton 把 slot 内容包进 .n-button__content，图标与文字要在这一层做 flex。
    :deep(.n-button__content) {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      width: 100%;
    }
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    opacity: 0.9;
  }

  &__back {
    margin-bottom: t.$space-1;
  }

  &__focus {
    margin-top: auto;
  }
}

.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  @include m.thin-scrollbar;
}

.focus-exit.focus-exit {
  position: absolute;
  top: t.$space-3;
  right: t.$space-3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--divider);
  border-radius: 50%;
  background: var(--bg-surface);
  background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  color: var(--text-soft);
  opacity: 0.5;
  transition: opacity t.$duration t.$ease, color t.$duration t.$ease;

  &:hover {
    color: var(--text-primary);
    opacity: 1;
  }
}
</style>
