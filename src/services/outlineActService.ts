import { settingsService } from "@/services/settingsService";
import { type Chapter, DEFAULT_ACT_COUNT, MAX_ACTS } from "@/types";

/**
 * 幕数按作品存在 app_meta。
 *
 * 章节自带 act 字段，有章节的幕天然能推导出来；但「刚新增还没放章节的空幕」没有载体，
 * 不单独存一份就会在刷新后消失，所以这里用 settingsService 记住幕数。
 */
const KEY_PREFIX = "outline_act_count:";

export async function loadActCount(projectId: string): Promise<number> {
  const raw = await settingsService.getString(`${KEY_PREFIX}${projectId}`);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_ACTS) : 0;
}

export async function saveActCount(projectId: string, count: number): Promise<void> {
  const next = Math.min(Math.max(1, Math.round(count)), MAX_ACTS);
  await settingsService.setString(`${KEY_PREFIX}${projectId}`, String(next));
}

/**
 * 实际渲染的幕数：已保存的幕数（0 表示从没存过，用默认三幕兜底）
 * 与章节里出现的最大幕取大。
 *
 * 不能再无条件 `max(DEFAULT_ACT_COUNT, ...)`：作者把第三幕删掉后，
 * 存的是 2，读回来又被抬回 3，表现为「删不掉，且再点删除静默无反应」。
 */
export function resolveActCount(stored: number, chapters: Pick<Chapter, "act">[]): number {
  const maxChapterAct = chapters.reduce((max, chapter) => Math.max(max, chapter.act), 0);
  const base = stored > 0 ? stored : DEFAULT_ACT_COUNT;
  return Math.min(MAX_ACTS, Math.max(1, base, maxChapterAct));
}
