import { createRouter, createWebHashHistory } from "vue-router";

/**
 * 应用路由表。全局页与作品内页刻意分开：作品 ID 写在路径上，
 * 由父路由负责加载作品、校验作用域，子路由只处理作品内的功能。
 *
 * 页面一律懒加载：12 个视图里有 tiptap、epub 生成、图表等重依赖，
 * 全量静态引入会把它们都塞进首屏 chunk，拖慢启动。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "workspace",
      component: () => import("@/views/WorkspaceView.vue"),
      meta: { title: "工作台" },
    },
    {
      // 全局设定库：汇总所有作品，只读。
      path: "/bible",
      name: "bible",
      component: () => import("@/views/GlobalBibleView.vue"),
      meta: { title: "全局设定库" },
    },
    {
      // 模型管理是全局页：Provider 不属于某部作品，配置对所有作品生效。
      path: "/models",
      name: "models",
      component: () => import("@/views/ModelSettingsView.vue"),
      meta: { title: "模型管理" },
    },
    {
      // 全局统计：汇总所有作品与 token 用量，只读；编辑必须进对应作品页。
      path: "/stats",
      name: "stats",
      component: () => import("@/views/GlobalStatsView.vue"),
      meta: { title: "全局统计" },
    },
    {
      // Agent 角色：全局配置，只定义 prompt 与工具白名单，不绑定模型。
      path: "/agent-roles",
      name: "agent-roles",
      component: () => import("@/views/AgentRolesView.vue"),
      meta: { title: "Agent 角色" },
    },
    {
      // Agent 评测：全局页，选作品跑固定任务集，结果按时间累积。
      path: "/agent-eval",
      name: "agent-eval",
      component: () => import("@/views/AgentEvalView.vue"),
      meta: { title: "Agent 评测" },
    },
    {
      // 作品作用域的父路由：ProjectShellView 校验 projectId 并加载作品，
      // 校验通过后才渲染下面的子页面，避免无 ID 时回退到全局数据。
      // 父路由刻意不取名：它唯一的空路径子路由只做重定向，带 name 会触发
      // 「named route has an unnamed empty-path child」警告，跳转一律用子路由名。
      path: "/projects/:projectId",
      component: () => import("@/views/ProjectShellView.vue"),
      children: [
        // 进入某部作品时默认打开它的设定库。
        { path: "", redirect: { name: "project-bible" } },
        {
          path: "bible",
          name: "project-bible",
          component: () => import("@/views/ProjectBibleView.vue"),
          props: true,
          meta: { title: "设定库" },
        },
        {
          // 作品内大纲看板：章节/场景/伏笔都限定在当前作品内。
          path: "outline",
          name: "project-outline",
          component: () => import("@/views/ProjectOutlineView.vue"),
          props: true,
          meta: { title: "大纲" },
        },
        {
          // 构思向导：把访谈结果写回当前作品的信息与大纲。
          path: "ideation",
          name: "project-ideation",
          component: () => import("@/views/ProjectIdeationView.vue"),
          props: true,
          meta: { title: "构思向导" },
        },
        {
          // 写作台：章节 id 放在路径上，没有 id 时页面只提示选章，不自动回退到第一章。
          path: "write/:chapterId?",
          name: "project-writing",
          component: () => import("@/views/ProjectWritingView.vue"),
          props: true,
          meta: { title: "写作台" },
        },
        {
          // 编辑审稿：报告只读，改稿跳回写作台，因此不需要把章节写进路径。
          path: "review",
          name: "project-review",
          component: () => import("@/views/ProjectReviewView.vue"),
          props: true,
          meta: { title: "编辑审稿" },
        },
        {
          // 出版中心：排版、导出与发布物料都属于当前作品，不提供全局汇总页。
          path: "publish",
          name: "project-publish",
          component: () => import("@/views/ProjectPublishView.vue"),
          props: true,
          meta: { title: "出版中心" },
        },
        {
          // 创作工作流：策划→写作→编辑→审稿→出版，作品 ID 在父路径上，人工审批才落地。
          path: "workflow",
          name: "project-workflow",
          component: () => import("@/views/ProjectWorkflowView.vue"),
          props: true,
          meta: { title: "创作工作流" },
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
    {
      // 兜底：未知地址给明确入口，而不是白屏。
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("@/views/NotFoundView.vue"),
      meta: { title: "页面不存在" },
    },
  ],
});

/**
 * 窗口标题跟随路由。Tauri 窗口标题默认取 tauri.conf.json 里的写死值，
 * 多标签/多窗口场景下用户无法从系统任务栏区分页面，这里同步一下。
 */
router.afterEach((to) => {
  const scope = to.path.startsWith("/projects/") ? "作品 · " : "";
  const title = typeof to.meta.title === "string" ? to.meta.title : "";
  document.title = title ? `INK-HARNESS · ${scope}${title}` : "INK-HARNESS";
});

export default router;
