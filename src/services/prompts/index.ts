/**
 * 提示词总入口。
 *
 * 面向模型的所有提示词构建函数都应从这里取，方便集中回顾与后续做 AB 测试。
 *
 * 已独立成文件：
 * - `summary`：章节摘要（决定 RAG 注入质量）
 * - `publicationBrief`：出版物料（简介/标签/封面简报/投稿信）
 *
 * 仍留在 service 内的两处，是有意为之：
 * - `workflowService.buildStageMessages`：与阶段常量（STAGE_TASK / 产物上限）和
 *   `projectFacts` 等共有辅助函数强耦合，拆出去会变成互相 import。
 * - `reviewService.buildReviewMessages`：与审稿报告的解析、分层规则同文件，
 *   拆开会让「提示词要求的字段」与「解析读取的字段」分离，反而更容易漂移。
 */

export { buildBriefMessages } from "@/services/prompts/publicationBrief";
export { buildSummaryMessages, clipChapterText } from "@/services/prompts/summary";
export { buildReviewMessages } from "@/services/reviewService";
export { buildStageMessages } from "@/services/workflowService";
