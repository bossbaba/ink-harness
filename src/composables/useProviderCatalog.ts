import { computed, type Ref, ref } from "vue";
import { useOllamaControl } from "@/composables/useOllamaControl";
import { modelRouter } from "@/services/modelRouter";
import { providerService } from "@/services/providerService";
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
  // 新探测的模型默认不勾选工具能力：是否支持需作者确认，误勾会让 Agent 发出无效工具请求。
  return { id, displayName: id, contextWindow: DEFAULT_CONTEXT_WINDOW, supportsTools: false };
}

/**
 * Provider 目录：列表、编辑弹窗、连接测试、模型同步。
 *
 * 所有持久化与钥匙串操作都收敛在这里，页面只负责渲染。
 * `error` 由调用方注入，便于把「Provider 管理」与「用量/设置」的失败汇总到同一处展示。
 */
export function useProviderCatalog(shared: { error: Ref<string> }) {
  const providers = ref<ProviderConfig[]>([]);
  const loading = ref(false);
  const busy = ref(false);
  /** 正在被「测试连接」的 Provider id；卡片上对应按钮转圈用。 */
  const testingId = ref("");
  /** 正在「同步模型」的 Provider id；与全局 busy 分开，避免所有卡片一起转圈。 */
  const syncingId = ref("");
  /** Provider id → 连接测试结果文案。 */
  const probeMessages = ref<Record<string, string>>({});

  // Ollama 的检测/启动与工作台共用同一套逻辑，这里只负责把它接到页面上。
  const {
    status: ollama,
    starting: ollamaStarting,
    refreshing: ollamaRefreshing,
    error: ollamaError,
    refresh: refreshOllama,
    start: startOllamaService,
  } = useOllamaControl();

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
      shared.error.value = `读取 Provider 失败：${String(err)}`;
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

  /** 勾选/取消模型的工具调用能力，随 Provider 一起保存。 */
  function setSupportsTools(id: string, checked: boolean): void {
    const model = draft.value.models.find((item) => item.id === id);
    if (model) model.supportsTools = checked;
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
    shared.error.value = "";
    try {
      await providerService.save({ ...provider, enabled });
      await load();
      await refreshRouter();
    } catch (err) {
      shared.error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function remove(provider: ProviderConfig): Promise<void> {
    busy.value = true;
    shared.error.value = "";
    try {
      if (provider.apiKeyRef) {
        // 密钥清理失败不阻止删除配置（配置已经没用了），但必须告知：
        // 否则钥匙串里会留下一条没人引用的密钥，用户也无从察觉。
        try {
          await providerService.clearApiKey(provider.apiKeyRef);
        } catch (keyErr) {
          shared.error.value = `Provider 已删除，但密钥清理失败：${String(keyErr)}`;
        }
      }
      await providerService.remove(provider.id);
      await load();
      await refreshRouter();
    } catch (err) {
      shared.error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  /** 卡片上的「测试连接」：不改变已保存配置。 */
  async function testProvider(provider: ProviderConfig): Promise<void> {
    if (testingId.value) return;
    testingId.value = provider.id;
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
    } finally {
      testingId.value = "";
    }
  }

  /**
   * 本地 Provider 的一键导入：探测后把模型全部启用（已启用的保留原上下文窗口），
   * 避免用户为了试一下界面还要手动逐个勾选。
   */
  async function syncModels(provider: ProviderConfig): Promise<void> {
    if (syncingId.value) return;
    syncingId.value = provider.id;
    probeMessages.value = { ...probeMessages.value, [provider.id]: "正在拉取模型…" };
    busy.value = true;
    try {
      const ids = await providerService.probe({
        baseUrl: provider.baseUrl,
        apiKeyRef: provider.apiKeyRef ?? undefined,
      });
      const models = ids.map(
        (id) => provider.models.find((model) => model.id === id) ?? toProviderModel(id),
      );
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
      syncingId.value = "";
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

  return {
    providers,
    loading,
    busy,
    testingId,
    syncingId,
    probeMessages,
    ollama,
    ollamaStarting,
    ollamaRefreshing,
    ollamaError,
    refreshOllama,
    startOllama,
    dialogShow,
    dialogIsNew,
    draft,
    apiKey,
    clearKey,
    probing,
    probeError,
    discovered,
    hasProbed,
    totalModels,
    load,
    openCreate,
    openEdit,
    probeDraft,
    toggleModel,
    isModelChecked,
    setContextWindow,
    setSupportsTools,
    save,
    toggleEnabled,
    remove,
    testProvider,
    syncModels,
  };
}
