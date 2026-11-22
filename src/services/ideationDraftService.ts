import { tauriApi } from "@/api/tauri";
import type { IdeaProposal, IdeationAnswers, IdeationDraft, IdeationDraftInput } from "@/types";

/**
 * 构思草稿的读写门面：页面与 composable 只认结构化对象，JSON 序列化在这里收口。
 *
 * 解析失败一律返回 null 而不是抛错：草稿是「恢复现场」的便利功能，
 * 问卷结构改过一版导致旧草稿读不出来时，应该退回空表单继续用，
 * 不能因为一份旧草稿把整个构思向导卡死在错误页。
 */
export const ideationDraftService = {
  async load(projectId: string): Promise<IdeationDraft | null> {
    const row = await tauriApi.loadIdeationDraft(projectId);
    if (!row) return null;
    return {
      projectId: row.projectId,
      answers: parseJson<IdeationAnswers>(row.answersJson),
      proposal: parseJson<IdeaProposal>(row.proposalJson),
      step: row.step,
      maxStep: row.maxStep,
      selectedTitle: row.selectedTitle,
      includeOutline: row.includeOutline,
      applied: row.applied,
      outlineCreated: row.outlineCreated,
      updatedAt: row.updatedAt,
    };
  },

  /** 写入草稿；返回后端记录的更新时间，用于界面显示「已自动保存」。 */
  async save(input: IdeationDraftInput): Promise<string> {
    const row = await tauriApi.saveIdeationDraft({
      projectId: input.projectId,
      answersJson: JSON.stringify(input.answers),
      proposalJson: input.proposal ? JSON.stringify(input.proposal) : "",
      step: input.step,
      maxStep: input.maxStep,
      selectedTitle: input.selectedTitle,
      includeOutline: input.includeOutline,
      applied: input.applied,
      outlineCreated: input.outlineCreated,
    });
    return row.updatedAt;
  },
};

/** 容错解析：空串或坏 JSON 都返回 null，不向外抛。 */
function parseJson<T>(raw: string): T | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
