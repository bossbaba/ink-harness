import { createRouter, createWebHashHistory } from "vue-router";
import GlobalBibleView from "@/views/GlobalBibleView.vue";
import ProjectBibleView from "@/views/ProjectBibleView.vue";
import ProjectShellView from "@/views/ProjectShellView.vue";
import WorkspaceView from "@/views/WorkspaceView.vue";

// 应用路由表。全局页与作品内页刻意分开：作品 ID 写在路径上，
// 由父路由负责加载作品、校验作用域，子路由只处理作品内的功能。
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "workspace",
      component: WorkspaceView,
    },
    {
      // 全局设定库：汇总所有作品，只读。
      path: "/bible",
      name: "bible",
      component: GlobalBibleView,
    },
    {
      // 作品作用域的父路由：ProjectShellView 校验 projectId 并加载作品，
      // 校验通过后才渲染下面的子页面，避免无 ID 时回退到全局数据。
      path: "/projects/:projectId",
      name: "project",
      component: ProjectShellView,
      children: [
        // 进入某部作品时默认打开它的设定库。
        { path: "", redirect: { name: "project-bible" } },
        {
          path: "bible",
          name: "project-bible",
          component: ProjectBibleView,
          props: true,
        },
      ],
    },
    {
      // 兼容旧版 /works/:projectId/bible 链接，统一收敛到作品设定库页面。
      path: "/works/:projectId/bible",
      redirect: (to) => ({
        name: "project-bible",
        params: to.params,
        query: to.query,
      }),
    },
  ],
});

export default router;
