<script setup lang="ts">
import { darkTheme, dateZhCN, NConfigProvider, zhCN } from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import ErrorBoundary from "@/components/common/ErrorBoundary.vue";
import NoticeStack from "@/components/common/NoticeStack.vue";
import { modelRouter } from "@/services/modelRouter";
import { useAppStore } from "@/stores/app";
import { applyPalette, naiveOverrides, palettes } from "@/theme/palette";

const app = useAppStore();
const route = useRoute();
// 重试时换 key 强制重建路由页：出错的组件实例可能已被 KeepAlive 缓存，
// 只切换 v-if 会重新挂载到同一个坏实例上。
const routeReloadKey = ref(0);

// 主题覆盖由 palette 单一真源派生，明暗切换时自动重算。
const themeOverrides = computed(() => naiveOverrides(palettes[app.appearance]));
const naiveTheme = computed(() => (app.appearance === "dark" ? darkTheme : null));

watch(
  () => app.appearance,
  (value) => applyPalette(palettes[value]),
  { immediate: true },
);

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && app.focusMode) app.toggleFocusMode();
}

onMounted(() => {
  app.initAppearance();
  applyPalette(palettes[app.appearance]);
  window.addEventListener("keydown", onKeydown);
  // 应用启动就加载一次路由缓存，顶栏「当前模型」无需先进入模型管理页才有值。
  // 读取失败不阻塞启动，进入模型管理页时会再加载一次。
  void modelRouter.refresh().catch(() => undefined);
});
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <!--
    必须显式指定中文 locale：naive-ui 默认是英文，NPopconfirm 会出现
    Confirm / Cancel，NDatePicker 会出现英文月份与星期。
  -->
  <NConfigProvider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    class="app-root"
  >
    <AppShell>
      <!--
        路由页统一缓存：切到设定库再回写作台时，编辑器正文、AI 面板、
        构思向导步骤、审稿报告都还在。列表类页面在 onReactivated 里自行补刷新。
      -->
      <!--
        页面级降级：某个页面渲染失败时只换掉主内容，侧栏与提示栈仍在，
        作者可以切到别的页面继续工作，也可以直接点重试重新载入。
      -->
      <ErrorBoundary
        :reset-key="route.fullPath"
        title="这个页面没能显示"
        description="其它功能仍可使用。重试会重新载入这一页；若反复出现，请先备份数据库再重启应用。"
        @retry="routeReloadKey += 1"
      >
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" :key="routeReloadKey" />
          </KeepAlive>
        </RouterView>
      </ErrorBoundary>
      <!-- 全局提示栈：兜住没人展示的异常（见 composables/useNotice.ts） -->
      <NoticeStack />
    </AppShell>
  </NConfigProvider>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;

.app-root {
  display: block;
  width: 100%;
  height: 100%;
  color: var(--text-primary, #{t.$ink});
  background: var(--bg-app, #{t.$paper});
}
</style>
