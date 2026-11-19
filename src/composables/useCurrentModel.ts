import { computed } from "vue";
import { modelRouter } from "@/services/modelRouter";

/**
 * 全局「当前使用的模型」展示源。
 *
 * 顶栏等位置需要回答「现在用的是哪个模型」。这里不另存一份状态，而是直接读
 * modelRouter.currentModel（selector 的唯一结果），保证显示的和 AI 实际调用的是同一个。
 * 首次挂载时加载一次 Provider 与设置；之后模型管理页的改动会通过同一个 router 反映过来。
 */
export function useCurrentModel() {
  const currentModel = modelRouter.currentModel;

  /** 顶栏短标签：模型显示名，未配置时给出明确提示。 */
  const currentModelLabel = computed(() => currentModel.value?.displayName ?? "未配置模型");

  /** tooltip 用的完整说明，带上来源，便于区分本地/云端同名模型。 */
  const currentModelDetail = computed(() => {
    const model = currentModel.value;
    if (!model) return "尚未配置可用模型，点击前往模型管理添加";
    return `当前使用：${model.displayName}（${model.source === "local" ? "本地" : "云端"} · ${model.id}）`;
  });

  return { currentModel, currentModelLabel, currentModelDetail };
}
