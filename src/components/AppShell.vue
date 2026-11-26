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
 * 应用外壳：全高侧栏（含品牌区） + 右侧舞台（顶栏 + 内容）。
 *
 * 布局严格对齐 Ardot 设计稿节点 3:196「01 工作台」的权威结构：
 * - 侧栏 248×900 贴满整个窗口高度，品牌区在侧栏最顶部（56px）；
 * - 顶栏 1192×64 位于 x=248，只在右侧内容舞台上方，与纸底内容区连成一片；
 * - 顶栏无底部分隔线，页面名在左侧剩余空间居中，右侧是模型状态/主题/设置。
 * 这和旧版「顶栏横跨全宽、侧栏在顶栏下方」是结构性差异，不能靠调数值补。
 *
 * 侧栏按路由作用域切换：全局页显示全局菜单，进入某个作品后换成该作品的二级导航
 * 并带「返回工作台」，两者不混排。专注模式下侧栏与顶栏全部隐藏，只留正文。
 */
const app = useAppStore();
const route = useRoute();
const router = useRouter();
// 顶栏的「当前模型」直接读路由选择结果，用户换默认模型/启停 Provider 后自动更新。
const { currentModelLabel, currentModelDetail } = useCurrentModel();

// 主题按钮显示的是「切换后」的图标：当前浅色则给出月亮，暗示点下去进入深色；反之给太阳。
const appearanceIcon = computed(() => (app.appearance === "light" ? "theme" : "sun"));

/**
 * macOS 上标题栏用 Overlay 样式，系统红绿灯直接画在窗口左上角。
 * 非专注模式下红绿灯压在侧栏品牌区上方，侧栏要整体下移让位；
 * 专注模式下侧栏消失，改由页面头部的 --page-header-inset 让位。
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
 * 顶栏中间的作用域标签。
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
  <!--
    专注模式没有侧栏与标题栏，作品页的面包屑会顶到窗口左上角、压在 macOS 红绿灯上。
    这里把「红绿灯安全区」作为 CSS 变量下发给页面，由需要贴顶的头部自行让位。
  -->
  <div
    class="shell"
    :class="{
      'shell--focus': app.focusMode,
      'shell--focus-lights': app.focusMode && hasTrafficLights,
    }"
  >
    <!-- 设计稿 3:197：侧栏贴满窗口全高，品牌区是它的第一个子元素。 -->
    <aside v-if="!app.focusMode" class="sidebar" :class="{ 'sidebar--lights': hasTrafficLights }">
      <div class="brand" data-tauri-drag-region>
        <span class="brand__mark">墨</span>
        <span class="brand__name">INK-HARNESS</span>
      </div>

      <template v-if="isProjectRoute">
        <RouterLink to="/" class="nav__item nav__back">
          <AppIcon name="chevron-left" :size="15" />
          <span class="nav__label">返回工作台</span>
        </RouterLink>
        <div class="sidebar__section">当前作品</div>
        <!-- 设计稿在「当前作品」下放一张带图标的作品名卡片，点它回到工作台。 -->
        <button class="project-chip" type="button" @click="router.push('/')">
          <span class="project-chip__icon" aria-hidden="true">
            <AppIcon name="workspace" :size="16" />
          </span>
          <span class="project-chip__name">{{ project?.title ?? "作品" }}</span>
        </button>
        <nav class="nav">
          <RouterLink
            v-for="item in projectNavItems"
            :key="item.key"
            :to="{ name: item.name, params: { projectId } }"
            class="nav__item"
            :class="{ 'nav__item--active': route.name === item.name }"
          >
            <AppIcon class="nav__icon" :name="item.icon" :size="18" />
            <span class="nav__label">{{ item.label }}</span>
          </RouterLink>
        </nav>
      </template>
      <template v-else>
        <!-- 与作品侧栏呼应：全局导航也给出分组标题，用户一眼看出这是系统级功能。 -->
        <div class="sidebar__section">工作空间</div>
        <nav class="nav">
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
            <AppIcon class="nav__icon" :name="item.icon" :size="18" />
            <span class="nav__label">{{ item.label }}</span>
          </NButton>
        </nav>
      </template>

      <NButton text block class="nav__item nav__focus" @click="app.toggleFocusMode()">
        <AppIcon class="nav__icon" name="focus" :size="18" />
        <span class="nav__label">专注模式</span>
      </NButton>
    </aside>

    <!-- 设计稿 3:229/3:236：顶栏与主内容区同属右侧舞台，顶栏不是全宽。 -->
    <div class="stage">
      <header v-if="!app.focusMode" class="titlebar" data-tauri-drag-region>
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
                <AppIcon :name="appearanceIcon" :size="18" />
              </NButton>
            </template>
            {{ app.appearance === "light" ? "切换到深色" : "切换到浅色" }}
          </NTooltip>
          <NTooltip>
            <template #trigger>
              <!-- 设计稿顶栏右侧是「模型状态 + 主题 + 设置」；设置直达模型管理（系统设置页）。 -->
              <NButton quaternary size="small" class="tool-button" @click="router.push('/models')">
                <AppIcon name="settings" :size="18" />
              </NButton>
            </template>
            系统设置（模型管理）
          </NTooltip>
        </div>
      </header>

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
// 导航样式按设计稿拆到同目录片段，scoped 作用域仍由本组件提供。
@use "./AppShell.nav";

// :deep 只能写在 SFC 里：NButton 把 slot 内容包进 .n-button__content，图标与文字在这一层做 flex。
.nav__item.nav__item :deep(.n-button__content) {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  width: 100%;
}

// 设计稿 3:196：侧栏与右侧舞台横向并排，侧栏吃满全高。
.shell {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  background: var(--bg-app);
  color: var(--text-primary);

  // 专注模式 + macOS：红绿灯画在窗口左上角，页面头部要把这块让出来。
  // 变量直接给「最终左内边距」，普通模式由页面自己的 token 兜底，不做叠加。
  &--focus-lights {
    --page-header-inset: 84px;
  }
}

// 右侧舞台：顶栏 + 内容，纵向排列。顶栏宽度因此天然等于「窗口宽 - 侧栏宽」。
.stage {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

// 设计稿 3:198：侧栏顶部品牌区，56px 高，标记与文字间距 10px。
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  height: 56px;

  &__mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    font-family: t.$font-serif;
    font-size: 16px;
    font-weight: 700;
  }

  &__name {
    @include m.ellipsis;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-primary);
  }
}

// 设计稿 3:229：顶栏是纸底，与内容区连成一片；无分隔线；左右内边距 24px。
.titlebar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: t.$space-4;
  height: 64px;
  padding: 0 t.$space-5;
  background: var(--bg-app);
  user-select: none;

  &__center {
    flex: 1;
    min-width: 0;
  }

  // 设计稿 3:230：页面名在 fill_container 的剩余空间里居中，13px Medium 墨字。
  &__project {
    @include m.ellipsis;
    display: block;
    text-align: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: t.$space-4;
    flex-shrink: 0;
  }
}

.tool-button {
  color: var(--text-soft);
}

// 顶栏当前模型标签：用主色淡底 + 圆点表示「正在生效」，可点击跳转模型管理。
.model-badge {
  max-width: 220px;
  cursor: pointer;
  color: var(--accent);
  background: var(--accent-soft);
  transition: box-shadow t.$duration t.$ease;

  // 小圆点把「当前生效」和旁边的静态按钮区分开。
  &::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--accent);
    vertical-align: middle;
  }

  &:hover {
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
}

// 设计稿 3:197：侧栏 248px 全高，四边 16px 内边距，条目间距 6px。
.sidebar {
  display: flex;
  flex-direction: column;
  width: 248px;
  flex-shrink: 0;
  gap: 6px;
  padding: t.$space-4;
  border-right: 1px solid var(--divider);
  background: var(--sidebar-bg, var(--bg-sunken));
  user-select: none;

  // macOS 红绿灯占据左上角约 28px，侧栏整体下移让开品牌区。
  &--lights {
    padding-top: 40px;
  }

  &__section {
    margin: t.$space-4 0 t.$space-2;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--text-faint);
  }
}

// 设计稿里的作品名卡片：浅色卡面 + 主色图标，点它回工作台。
.project-chip {
  display: flex;
  align-items: center;
  gap: t.$space-2;
  width: 100%;
  min-height: 46px;
  margin: 0 0 t.$space-2;
  padding: t.$space-2 t.$space-3;
  border: 1px solid var(--divider);
  border-radius: t.$radius-md;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: border-color t.$duration t.$ease, box-shadow t.$duration t.$ease;

  &:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 8px var(--accent-soft);
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: t.$radius-sm;
    background: var(--accent-soft);
    color: var(--accent);
  }

  &__name {
    @include m.ellipsis;
    min-width: 0;
  }
}

.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  // 设计稿的内容区是干净的纸底，纵深交给页面内的卡片与 Hero 面板，不再叠全局环境光。
  background: var(--bg-app);
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
