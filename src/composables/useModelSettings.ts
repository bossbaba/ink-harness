import { onMounted, ref } from "vue";
import { useAppSettings } from "@/composables/useAppSettings";
import { useProviderCatalog } from "@/composables/useProviderCatalog";

/**
 * 模型管理页的组装入口。
 *
 * 页面只调这一个 composable，但它本身不再承载业务逻辑：
 * - `useProviderCatalog`：Provider 增删改、连接测试、模型同步、Ollama 探测；
 * - `useAppSettings`：退出停模型、全局路由策略。
 *
 * 拆开的原因是原来 430 多行的单文件里混了两个互不相干的领域，
 * 改一处设置不必再读懂 Provider 编辑弹窗；现在每块都能独立阅读与测试。
 * 用量与预算看板只在统计页提供，避免两处重复维护。
 * 返回对象保持原有键名，页面无需改动。
 */
export function useModelSettings() {
  // 两块都会产生错误，统一汇总到同一个 error 给页面展示。
  const error = ref("");

  const catalog = useProviderCatalog({ error });
  const settings = useAppSettings({ error });

  onMounted(async () => {
    // 首屏并行加载：任一失败由各自的 error 文案体现，不互相阻塞。
    await Promise.all([
      catalog.load(),
      catalog.refreshOllama(),
      settings.loadStopOnExit(),
      settings.loadRouteStrategy(),
    ]);
  });

  return { ...catalog, ...settings, error };
}
