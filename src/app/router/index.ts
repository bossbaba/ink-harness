import { createRouter, createWebHashHistory } from "vue-router";
import GlobalBibleView from "@/views/GlobalBibleView.vue";
import ModelSettingsView from "@/views/ModelSettingsView.vue";
import ProjectBibleView from "@/views/ProjectBibleView.vue";
import ProjectIdeationView from "@/views/ProjectIdeationView.vue";
import ProjectOutlineView from "@/views/ProjectOutlineView.vue";
import ProjectReviewView from "@/views/ProjectReviewView.vue";
import ProjectShellView from "@/views/ProjectShellView.vue";
import ProjectWritingView from "@/views/ProjectWritingView.vue";
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
      // 模型管理是全局页：Provider 不属于某部作品，配置对所有作品生效。
      path: "/models",
      name: "models",
      component: ModelSettingsView,
    },
    {
      // 作品作用域的父路由：ProjectShellView 校验 projectId 并加载作品，
      // 校验通过后才渲染下面的子页面，避免无 ID 时回退到全局数据。
      // 父路由刻意不取名：它唯一的空路径子路由只做重定向，带 name 会触发
      // 「named route has an unnamed empty-path child」警告，跳转一律用子路由名。
      path: "/projects/:projectId",
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
        {
          // 作品内大纲看板：章节/场景/伏笔都限定在当前作品内。
          path: "outline",
          name: "project-outline",
          component: ProjectOutlineView,
          props: true,
        },
        {
          // 构思向导：把访谈结果写回当前作品的信息与大纲。
          path: "ideation",
          name: "project-ideation",
          component: ProjectIdeationView,
          props: true,
        },
        {
          // 写作台：章节 id 放在路径上，没有 id 时页面只提示选章，不自动回退到第一章。
          path: "write/:chapterId?",
          name: "project-writing",
          component: ProjectWritingView,
          props: true,
        },
        {
          // 编辑审稿：报告只读，改稿跳回写作台，因此不需要把章节写进路径。
          path: "review",
          name: "project-review",
          component: ProjectReviewView,
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
