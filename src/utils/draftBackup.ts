/**
 * 章节正文的本地兜底备份。
 *
 * 自动保存写库失败时（数据库被锁、磁盘满、后端未就绪），正文只存在编辑器里，
 * 一旦关窗或崩溃就彻底丢了。这里把正文顺手存进 localStorage，下次载入该章时
 * 只要本地备份比库里新就提示恢复。
 *
 * 刻意只用 localStorage 做「兜底」：它不是第二份真源，成功落库后立刻清掉，
 * 避免出现两份互相打架的正文。
 */

const DRAFT_BACKUP_PREFIX = "ink:draft-backup:";

export interface DraftBackup {
  content: string;
  wordCount: number;
  /** 写入时间戳，用来判断本地备份是否比库里的正文更新。 */
  savedAt: number;
}

function backupKey(chapterId: string): string {
  return `${DRAFT_BACKUP_PREFIX}${chapterId}`;
}

/** 读本地备份；损坏的记录直接丢弃，不能让兜底数据把正常加载带崩。 */
export function readDraftBackup(chapterId: string): DraftBackup | null {
  try {
    const raw = localStorage.getItem(backupKey(chapterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftBackup>;
    if (typeof parsed.content !== "string" || typeof parsed.savedAt !== "number") {
      localStorage.removeItem(backupKey(chapterId));
      return null;
    }
    return {
      content: parsed.content,
      wordCount: typeof parsed.wordCount === "number" ? parsed.wordCount : 0,
      savedAt: parsed.savedAt,
    };
  } catch {
    // 隐私模式禁用存储、或 JSON 损坏：都当作没有备份。
    return null;
  }
}

/**
 * 写本地备份，返回是否真的写成功。
 *
 * 调用方要据此决定提示文案：写库失败又赶上 localStorage 禁用时，
 * 不能再告诉作者「正文已留在本地备份」，那会给他错误的安全感。
 */
export function writeDraftBackup(
  chapterId: string,
  payload: { content: string; wordCount: number },
): boolean {
  try {
    const backup: DraftBackup = { ...payload, savedAt: Date.now() };
    localStorage.setItem(backupKey(chapterId), JSON.stringify(backup));
    return true;
  } catch {
    // 配额满或存储被禁用：返回失败，由调用方改成「请手动复制」的提示。
    return false;
  }
}

/** 清理已落库章节的备份；返回是否清掉，失败不影响主流程（下次成功保存会再清）。 */
export function clearDraftBackup(chapterId: string): boolean {
  try {
    localStorage.removeItem(backupKey(chapterId));
    return true;
  } catch {
    return false;
  }
}
