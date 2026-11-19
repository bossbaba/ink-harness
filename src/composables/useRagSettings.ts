import { computed, type Ref, ref } from "vue";
import { SETTING_RAG_MODEL, settingsService } from "@/services/settingsService";
import type { ProviderConfig } from "@/types";

/**
 * RAG 检索模型设置：读写一条全局设置（用哪个模型做向量化）。
 *
 * 从 RagSettingsPanel 上移而来——组件只负责展示选项与错误，设置的读写、
 * 选项派生与「已失效」判断都收在这里，遵循「组件只走 props/emit」的分层。
 */
export function useRagSettings(providers: Ref<ProviderConfig[]>, shared: { error: Ref<string> }) {
  const current = ref("");
  const saving = ref(false);
  const localError = ref("");

  /** 选项来自已启用 Provider 下已勾选的模型，值与后端一致用 `providerId:modelId`。 */
  const options = computed(() =>
    providers.value
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          label: `${provider.name} · ${model.id}`,
          value: `${provider.id}:${model.id}`,
        })),
      ),
  );

  /** 存下来的模型可能已被删或停用，提前提示重选，避免到写作时才发现不可用。 */
  const unavailable = computed(
    () => current.value !== "" && !options.value.some((item) => item.value === current.value),
  );

  async function load(): Promise<void> {
    current.value = await settingsService.getString(SETTING_RAG_MODEL);
  }

  /** 改模型先落库再改内存；写失败回滚界面值并显示错误。 */
  async function setModel(value: string | null): Promise<void> {
    const previous = current.value;
    current.value = value ?? "";
    saving.value = true;
    localError.value = "";
    try {
      await settingsService.setString(SETTING_RAG_MODEL, current.value);
    } catch (err) {
      current.value = previous;
      localError.value = `保存失败：${err instanceof Error ? err.message : String(err)}`;
      shared.error.value = localError.value;
    } finally {
      saving.value = false;
    }
  }

  return { current, saving, options, unavailable, error: localError, load, setModel };
}
