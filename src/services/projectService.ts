import { tauriApi } from "@/api/tauri";
import type { DatabaseInfo, NewProject, Project } from "@/types";

/** 作品领域服务：视图层只依赖此服务，不直接调 IPC。 */
export const projectService = {
  list: (): Promise<Project[]> => tauriApi.listProjects(),

  create: (input: NewProject): Promise<Project> => tauriApi.createProject(input),

  get: (id: string): Promise<Project | null> => tauriApi.getProject(id),

  update: (project: Project): Promise<void> => tauriApi.updateProject(project),

  remove: (id: string): Promise<void> => tauriApi.deleteProject(id),

  databaseInfo: (): Promise<DatabaseInfo> => tauriApi.databaseInfo(),
};
