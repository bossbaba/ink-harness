/**
 * localStorage 的带前缀小封装：service 只拿读写接口，不直接碰 Web Storage。
 *
 * 每次调用都重新读 `globalThis.localStorage`，这样测试里 `vi.stubGlobal` 换掉实现、
 * 或 `vi.resetModules()` 重新导入模块后都能立刻生效；前缀过滤统一在这里做，
 * 免得清理逻辑误删同页面的其它键。node 测试环境没有 localStorage 时返回 null，
 * 调用方自然退化为纯内存队列。
 */
export interface ScopedStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
  keys(): string[];
}

export function getScopedStorage(prefix: string): ScopedStorage | null {
  const store = typeof localStorage === "undefined" ? null : localStorage;
  if (!store) return null;
  return {
    get(key) {
      try {
        return store.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store.setItem(prefix + key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        store.removeItem(prefix + key);
        return true;
      } catch {
        return false;
      }
    },
    keys() {
      try {
        const out: string[] = [];
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index);
          if (key?.startsWith(prefix)) out.push(key);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
