/**
 * 统计正文字数：先去掉所有空白（含换行、全角空格），再按字符计数。
 * 中英混排时逐字符计数比「按空格断词」稳定得多，也与多数写作软件的「字符数」一致；
 * 这个口径由前端编辑器算好后回写后端，库里的 word_count 一律信任该值。
 */
export function countCharacters(text: string): number {
  return text.replace(/\s/gu, "").length;
}

/**
 * 把后端返回的 ISO 时间格式化成「MM-DD HH:mm」。
 * 时间串异常时直接返回原文，避免列表里出现 Invalid Date。
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 千分位字数，用于顶部统计这类一眼看数量的位置。 */
export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}
