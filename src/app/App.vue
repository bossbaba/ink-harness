<script setup lang="ts">
import { darkTheme, dateZhCN, NConfigProvider, zhCN } from "naive-ui";
import { computed, onMounted, onUnmounted, watch } from "vue";
import { RouterView } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import NoticeStack from "@/components/common/NoticeStack.vue";
import { modelRouter } from "@/services/modelRouter";
import { useAppStore } from "@/stores/app";
import { applyPalette, naiveOverrides, palettes } from "@/theme/palette";

const app = useAppStore();

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
      <RouterView v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
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
