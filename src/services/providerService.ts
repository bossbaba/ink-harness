import { tauriApi } from "@/api/tauri";
import type { ProbeProviderInput, ProviderConfig } from "@/types";

/**
 * Provider 领域服务：配置持久化 + 连接探测 + 密钥钥匙串读写。
 * 密钥明文只经过 saveApiKey 一次写入系统钥匙串，数据库里只存引用键名。
 */
export const providerService = {
  list: (): Promise<ProviderConfig[]> => tauriApi.listProviders(),
  save: (config: ProviderConfig): Promise<ProviderConfig> => tauriApi.saveProvider(config),
  remove: (id: string): Promise<void> => tauriApi.removeProvider(id),
  probe: (input: ProbeProviderInput): Promise<string[]> => tauriApi.probeProvider(input),

  /** 统一的钥匙串键名规则，保证编辑与清理指向同一条记录。 */
  keychainRef: (providerId: string): string => `provider:${providerId}`,
  saveApiKey: (ref: string, key: string): Promise<void> => tauriApi.keychainSet(ref, key),
  clearApiKey: (ref: string): Promise<void> => tauriApi.keychainDelete(ref),
};
