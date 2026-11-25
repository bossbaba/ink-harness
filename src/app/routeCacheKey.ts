/**
 * 生成路由页在 KeepAlive 中的缓存键。
 *
 * Vue 3.5 的 KeepAlive 只按 vnode.key 取缓存实例，不校验组件类型。若所有路由
 * 共用一个固定 key（例如初始为 0 的重试计数），跨路由导航会命中上一个路由的
 * 组件实例，轻则显示错页，重则抛 `parentComponent.ctx.deactivate is not a function`。
 * 因此把「路由身份」和「重试序号」拼成字符串，保证每条路由独立缓存、重试又能
 * 换一棵全新子树。
 *
 * 路由身份取 `path` 而非其它值：
 * - 不用 `name`：同一路由模板下的不同实体（如 /projects/1/bible 与 /projects/2/bible）
 *   必须各有一份缓存，否则切换作品时会复用旧实体的实例。
 * - 不用 `fullPath`：query 只用于过滤与定位，改变定位参数不应该重建写作台、
 *   丢掉编辑器里未保存的状态。
 */
export function routeCacheKey(path: string, reloadKey: number): string {
  return `${path}:${reloadKey}`;
}
