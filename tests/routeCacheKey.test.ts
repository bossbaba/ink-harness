import { describe, expect, it } from "vitest";
import {
  type Component,
  createRenderer,
  defineComponent,
  h,
  KeepAlive,
  nextTick,
  ref,
  shallowRef,
} from "vue";
import { routeCacheKey } from "@/app/routeCacheKey";

/**
 * 路由缓存键的契约测试。
 *
 * App.vue 把「路径 + 重试序号」作为 KeepAlive 的 key。这里不挂载真实页面
 * （会带出 router / naive-ui / tauri 等一堆环境依赖），而是用 Vue 自带的
 * 自定义渲染器复刻同一段 `<KeepAlive><component :is :key /></KeepAlive>`，
 * 确保这条 key 约定不会在后续改动中被无意改回共用的数字 key。
 */

interface HostNode {
  tag: string;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
}

const { createApp } = createRenderer<HostNode, HostNode>({
  createElement: (tag) => ({ tag, children: [], parent: null, text: "" }),
  createText: (text) => ({ tag: "#text", children: [], parent: null, text }),
  createComment: (text) => ({ tag: "#comment", children: [], parent: null, text }),
  setText: (node, text) => {
    node.text = text;
  },
  setElementText: (node, text) => {
    node.text = text;
  },
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  insert: (child, parent, anchor) => {
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index >= 0) parent.children.splice(index, 0, child);
    else parent.children.push(child);
  },
  remove: (child) => {
    if (!child.parent) return;
    const index = child.parent.children.indexOf(child);
    if (index >= 0) child.parent.children.splice(index, 1);
    child.parent = null;
  },
  patchProp: () => undefined,
});

describe("routeCacheKey", () => {
  it("用路径和重试序号组合，且忽略只用于定位的 query", () => {
    expect(routeCacheKey("/bible", 0)).toBe("/bible:0");
    expect(routeCacheKey("/bible", 1)).toBe("/bible:1");
    // 同一路由模板下的不同实体必须各自缓存，不能只按 name 区分。
    expect(routeCacheKey("/projects/1/bible", 0)).not.toBe(routeCacheKey("/projects/2/bible", 0));
  });

  it("组合 key 下跨路由切换正常，且切回时复用旧实例", async () => {
    let aSetups = 0;
    const PageA = defineComponent({
      name: "PageA",
      setup() {
        aSetups += 1;
        return () => h("div", "A");
      },
    });
    const PageB = defineComponent({
      name: "PageB",
      setup: () => () => h("div", "B"),
    });

    const current = shallowRef<Component>(PageA);
    const path = ref("/a");
    const reloadKey = ref(0);
    const errors: unknown[] = [];

    const Root = defineComponent({
      setup: () => () =>
        h(KeepAlive, null, {
          default: () => h(current.value, { key: routeCacheKey(path.value, reloadKey.value) }),
        }),
    });

    const app = createApp(Root);
    // KeepAlive 的激活错误走应用级 errorHandler，这里收集起来做断言。
    app.config.errorHandler = (error) => errors.push(error);
    app.mount({ tag: "root", children: [], parent: null, text: "" });

    current.value = PageB;
    path.value = "/b";
    await nextTick();
    expect(errors).toEqual([]);

    current.value = PageA;
    path.value = "/a";
    await nextTick();
    expect(errors).toEqual([]);
    // A 的实例被 KeepAlive 留住，切回来没有重新执行 setup。
    expect(aSetups).toBe(1);
  });

  it("共用数字 key 会命中错误实例（修复动机，防止回退）", async () => {
    const PageA = defineComponent({ name: "PageA", setup: () => () => h("div", "A") });
    const PageB = defineComponent({ name: "PageB", setup: () => () => h("div", "B") });

    const current = shallowRef<Component>(PageA);
    const errors: unknown[] = [];
    const Root = defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => h(current.value, { key: 0 }) }),
    });

    const app = createApp(Root);
    app.config.errorHandler = (error) => errors.push(error);
    app.mount({ tag: "root", children: [], parent: null, text: "" });

    current.value = PageB;
    await nextTick();
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0])).toContain("deactivate");
  });
});
