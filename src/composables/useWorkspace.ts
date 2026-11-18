import { computed, onMounted, ref } from "vue";
import { projectService } from "@/services/projectService";
import { runtimeService } from "@/services/runtimeService";
import { useAppStore } from "@/stores/app";
import type { DatabaseInfo, Project } from "@/types";
import { onReactivated } from "@/utils/lifecycle";
import { useOllamaControl } from "./useOllamaControl";

/**
 * 工作台状态：作品列表与本地运行时探测。
 * 各探测项独立失败、互不影响；把兜底逻辑收在这里，让 view 只负责组装模板和导航。
 */
export function useWorkspace() {
  const app = useAppStore();
  const backend = ref("检测中…");
  const projects = ref<Project[]>([]);
  const dbInfo = ref<DatabaseInfo | null>(null);
  const showNew = ref(false);
  const error = ref("");

  const {
    status: ollama,
    starting: ollamaStarting,
    error: ollamaError,
    refresh: refreshOllama,
    start: startOllama,
  } = useOllamaControl();

  const ollamaRunning = computed(() => ollama.value?.running ?? false);
  const ollamaModels = computed(() => ollama.value?.models ?? []);

  async function loadProjects(): Promise<void> {
    try {
      projects.value = await projectService.list();
    } catch (err) {
      error.value = `读取作品失败：${String(err)}`;
    }
  }

  /** 首屏初始化：主题同步到 document，再并行探测本地运行时环境。 */
  async function load(): Promise<void> {
    // 后端探测失败也只影响状态卡片，不阻断作品列表加载。
    try {
      backend.value = await runtimeService.ping();
    } catch (err) {
      backend.value = `后端未就绪：${String(err)}`;
    }
    // 检测失败时状态保持 null，界面上只显示「未运行」，不弹错误打扰首屏。
    await refreshOllama();
    await loadProjects();
    try {
      dbInfo.value = await projectService.databaseInfo();
    } catch {
      dbInfo.value = null;
    }
  }

  onMounted(async () => {
    app.initAppearance();
    await load();
  });

  // keep-alive 缓存后 onMounted 只跑一次，从作品里回来时补刷作品列表。
  onReactivated(() => void loadProjects());

  return {
    app,
    backend,
    projects,
    dbInfo,
    showNew,
    error,
    ollamaRunning,
    ollamaModels,
    ollamaError,
    ollamaStarting,
    startOllama,
    loadProjects,
  };
}
