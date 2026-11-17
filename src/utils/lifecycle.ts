import { onActivated } from "vue";

/**
 * 只在「从 keep-alive 缓存里回来」时执行，首次挂载不执行。
 *
 * 页面被缓存后 `onMounted` 不会再触发，列表类页面（作品列表、设定库、大纲）
 * 从别的页面改完数据回来时就会看到旧数据；用它在回来时补一次刷新。
 * 注意 `onActivated` 在首次插入 DOM 时也会触发，所以用「跳过第一次」把
 * 重新激活和初次挂载区分开，避免首屏请求两次。
 */
export function onReactivated(callback: () => void): void {
  let first = true;
  onActivated(() => {
    if (first) {
      first = false;
      return;
    }
    callback();
  });
}
