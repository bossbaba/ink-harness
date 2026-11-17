import { computed, onMounted, ref } from "vue";
import { useOllamaControl } from "@/composables/useOllamaControl";
import { modelRouter } from "@/services/modelRouter";
import { providerService } from "@/services/providerService";
import { SETTING_STOP_OLLAMA_ON_EXIT, settingsService } from "@/services/settingsService";
import { DEFAULT_CONTEXT_WINDOW, type ProviderConfig, type ProviderModel } from "@/types";

function emptyProvider(): ProviderConfig {
  return {
    id: "",
    name: "",
    source: "local",
    baseUrl: "http://localhost:11434/v1",
    enabled: true,
    models: [],
  };
}

function toProviderModel(id: string): ProviderModel {
  return { id, displayName: id, contextWindow: DEFAULT_CONTEXT_WINDOW };
}

/**
 * 模型管理状态：Provider 列表、Ollama 探测、编辑弹窗与连接测试。
 * 页面只负责渲染；所有持久化与钥匙串操作都收敛在这里。
 */
export function useModelSettings() {
  const providers = ref<ProviderConfig[]>([]);
  // Ollama 的检测/启动与工作台共用同一套逻辑，这里只负责把它接到页面上。
  const {
    status: ollama,
    starting: ollamaStarting,
    error: ollamaError,
    refresh: refreshOllama,
    start: startOllamaService,
  } = useOllamaControl();
  /** 退出应用时是否停掉本地模型（只影响本应用拉起的实例），默认开。 */
  const stopOllamaOnExit = ref(true);
  const savingSetting = ref(false);
  const loading = ref(false);
  const busy = ref(false);
  const error = ref("");
  /** Provider id → 连接测试结果文案。 */
  const probeMessages = ref<Record<string, string>>({});

  const dialogShow = ref(false);
  const dialogIsNew = ref(true);
  const draft = ref<ProviderConfig>(emptyProvider());
  const apiKey = ref("");
  const clearKey = ref(false);
  const probing = ref(false);
  const probeError = ref("");
  /** 本次探测返回的模型 id；首次探测会自动勾选全部。 */
  const discovered = ref<string[]>([]);
  const hasProbed = ref(false);

  const totalModels = computed(() =>
    providers.value.reduce((sum, provider) => sum + provider.models.length, 0),
  );

  async function load(): Promise<void> {
    loading.value = true;
    try {
      providers.value = await providerService.list();
    } catch (err) {
      error.value = `读取 Provider 失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 保存后同步路由缓存，避免选模型时还在用旧列表。 */
  async function refreshRouter(): Promise<void> {
    try {
      await modelRouter.refresh();
    } catch {
      // 路由缓存刷新失败不影响配置本身，下次调用会重新拉取。
    }
  }

  function openCreate(): void {
    draft.value = emptyProvider();
    dialogIsNew.value = true;
    apiKey.value = "";
    clearKey.value = false;
    probeError.value = "";
    discovered.value = [];
    hasProbed.value = false;
    dialogShow.value = true;
  }

  function openEdit(provider: ProviderConfig): void {
    draft.value = {
      ...provider,
      models: provider.models.map((model) => ({ ...model })),
    };
    dialogIsNew.value = false;
    apiKey.value = "";
    clearKey.value = false;
    probeError.value = "";
    discovered.value = provider.models.map((model) => model.id);
    hasProbed.value = true;
    dialogShow.value = true;
  }

  async function probeDraft(): Promise<void> {
    if (!draft.value.baseUrl.trim()) {
      probeError.value = "请先填写服务地址";
      return;
    }
    probing.value = true;
    probeError.value = "";
    try {
      const ids = await providerService.probe({
        baseUrl: draft.value.baseUrl,
        apiKey: apiKey.value.trim() || undefined,
        // 编辑已保存的 Provider 时用户通常不会重输密钥，交给后端从钥匙串取。
        apiKeyRef: clearKey.value ? undefined : (draft.value.apiKeyRef ?? undefined),
      });
      discovered.value = Array.from(new Set([...ids, ...draft.value.models.map((m) => m.id)]));
      if (!hasProbed.value) {
        // 首次探测把发现的模型全部启用，用户再按需取消，比逐个勾选省事。
        for (const id of ids) {
          if (!draft.value.models.some((model) => model.id === id)) {
            draft.value.models.push(toProviderModel(id));
          }
        }
        hasProbed.value = true;
      }
    } catch (err) {
      probeError.value = String(err);
    } finally {
      probing.value = false;
    }
  }

  function toggleModel(id: string, checked: boolean): void {
    if (checked) {
      if (!draft.value.models.some((model) => model.id === id)) {
        draft.value.models.push(toProviderModel(id));
      }
      return;
    }
    draft.value.models = draft.value.models.filter((model) => model.id !== id);
  }

  function isModelChecked(id: string): boolean {
    return draft.value.models.some((model) => model.id === id);
  }

  function setContextWindow(id: string, value: number | null): void {
    const model = draft.value.models.find((item) => item.id === id);
    if (model && value) model.contextWindow = value;
  }

  async function save(): Promise<void> {
    if (!draft.value.name.trim()) {
      probeError.value = "请填写 Provider 名称";
      return;
    }
    if (!draft.value.baseUrl.trim()) {
      probeError.value = "请填写服务地址";
      return;
    }
    busy.value = true;
    probeError.value = "";
    try {
      let saved = await providerService.save({
        ...draft.value,
        models: draft.value.models.map((model) => ({
          ...model,
          displayName: model.displayName || model.id,
        })),
      });

      if (clearKey.value && saved.apiKeyRef) {
        await providerService.clearApiKey(saved.apiKeyRef);
        saved = await providerService.save({ ...saved, apiKeyRef: undefined });
      }
      if (apiKey.value.trim()) {
        const ref = providerService.keychainRef(saved.id);
        await providerService.saveApiKey(ref, apiKey.value.trim());
        saved = await providerService.save({ ...saved, apiKeyRef: ref });
      }

      dialogShow.value = false;
      apiKey.value = "";
      await load();
      await refreshRouter();
    } catch (err) {
      probeError.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function toggleEnabled(provider: ProviderConfig, enabled: boolean): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await providerService.save({ ...provider, enabled });
      await load();
      await refreshRouter();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function remove(provider: ProviderConfig): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      if (provider.apiKeyRef) {
        await providerService.clearApiKey(provider.apiKeyRef).catch(() => undefined);
      }
      await providerService.remove(provider.id);
      await load();
      await refreshRouter();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  /** 卡片上的「测试连接」：不改变已保存配置。 */
  async function testProvider(provider: ProviderConfig): Promise<void> {
    probeMessages.value = { ...probeMessages.value, [provider.id]: "测试中…" };
    try {
      const ids = await providerService.probe({
        baseUrl: provider.baseUrl,
        apiKeyRef: provider.apiKeyRef ?? undefined,
      });
      probeMessages.value = {
        ...probeMessages.value,
        [provider.id]:
          ids.length > 0 ? `连接成功，发现 ${ids.length} 个模型` : "连接成功，但没有可用模型",
      };
    } catch (err) {
      probeMessages.value = { ...probeMessages.value, [provider.id]: String(err) };
    }
  }

  /**
   * 本地 Provider 的一键导入：探测后把模型全部启用（已启用的保留原上下文窗口），
   * 避免用户为了试一下界面还要手动逐个勾选。
   */
  async function syncModels(provider: ProviderConfig): Promise<void> {
    probeMessages.value = { ...probeMessages.value, [provider.id]: "正在拉取模型…" };
    busy.value = true;
    try {
      const ids = await providerService.probe({
        baseUrl: provider.baseUrl,
        apiKeyRef: provider.apiKeyRef ?? undefined,
      });
      const models = ids.map((id) => {
        const existing = provider.models.find((model) => model.id === id);
        return existing ?? toProviderModel(id);
      });
      await providerService.save({ ...provider, models });
      await load();
      await refreshRouter();
      probeMessages.value = {
        ...probeMessages.value,
        [provider.id]: `已同步 ${ids.length} 个模型`,
      };
    } catch (err) {
      probeMessages.value = { ...probeMessages.value, [provider.id]: String(err) };
    } finally {
      busy.value = false;
    }
  }

  /**
   * 页面上点「启动本地模型」：启动成功后，如果本地 Provider 还一个模型都没启用，
   * 顺手同步一次，省得用户再点「同步模型」。
   */
  async function startOllama(): Promise<void> {
    const started = await startOllamaService();
    if (!started) return;
    const local = providers.value.find(
      (provider) => provider.source === "local" && provider.enabled && provider.models.length === 0,
    );
    if (local) await syncModels(local);
  }

  async function loadStopOnExit(): Promise<void> {
    stopOllamaOnExit.value = await settingsService.getBool(SETTING_STOP_OLLAMA_ON_EXIT, true);
  }

  /**
   * 切换「退出时停止本地模型」。
   * 先改界面再落库；写失败要回滚开关，否则界面显示的和实际生效的不一致。
   */
  async function setStopOllamaOnExit(value: boolean): Promise<void> {
    const previous = stopOllamaOnExit.value;
    stopOllamaOnExit.value = value;
    savingSetting.value = true;
    error.value = "";
    try {
      await settingsService.setBool(SETTING_STOP_OLLAMA_ON_EXIT, value);
    } catch (err) {
      stopOllamaOnExit.value = previous;
      error.value = `保存设置失败：${String(err)}`;
    } finally {
      savingSetting.value = false;
    }
  }

  onMounted(async () => {
    await Promise.all([load(), refreshOllama(), loadStopOnExit()]);
  });

  return {
    providers,
    ollama,
    ollamaStarting,
    ollamaError,
    stopOllamaOnExit,
    savingSetting,
    loading,
    busy,
    error,
    probeMessages,
    totalModels,
    dialogShow,
    dialogIsNew,
    draft,
    apiKey,
    clearKey,
    probing,
    probeError,
    discovered,
    hasProbed,
    load,
    refreshOllama,
    startOllama,
    setStopOllamaOnExit,
    openCreate,
    openEdit,
    probeDraft,
    toggleModel,
    isModelChecked,
    setContextWindow,
    save,
    toggleEnabled,
    remove,
    testProvider,
    syncModels,
  };
}
