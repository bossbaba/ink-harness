//! RAG 索引与检索：把设定条目与章节正文切成片段、向量化后写入 vec0 表，
//! 提问时按问题向量取最近的若干片段，作为「参考资料」注入提示词。
//!
//! 两条连接分工：`rag_chunk`（业务库）存片段正文与来源，`vec_rag`（向量库）存向量，
//! rowid 一一对应。向量维度由 embedding 模型决定，换模型时整表重建（旧向量作废）。

use rusqlite::{params, OptionalExtension};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{RagHit, RagStatus};
use crate::services::{embed, project, setting};

mod chunk;

/// 向量表维度记录在 app_meta；与当前模型输出维度不同说明换过模型，必须重建。
const DIM_KEY: &str = "rag_dim";
/// 建索引时用的 embedding 模型；与当前选中的不一致说明索引该重建了。
const INDEXED_MODEL_KEY: &str = "rag_indexed_model";
/// KNN 先多取一些再按作品过滤：同库多作品时，别人的片段会占掉候选位。
const KNN_OVERSCAN: i64 = 8;
const MAX_LIMIT: usize = 20;

/// 待写入索引的一个片段。
struct ChunkDraft {
    /// element（设定条目）或 chapter（章节正文片段）。
    kind: String,
    source_id: String,
    title: String,
    content: String,
}

/// 作品是否只允许本地处理。
///
/// 建索引与检索都要把正文（片段或问题）发给 embedding 服务，仅本地作品只能走本地
/// Provider，否则等于绕过隐私分级。判定口径统一收在 `project::is_local_only`，
/// 避免与 `gateway` 各写一份、语义慢慢漂移。
fn local_only_project(state: &DbState, project_id: &str) -> Result<bool, AppError> {
    project::is_local_only(state, project_id)
}

/// 某作品的索引状态；前端据此提示「未建索引 / 索引过期 / 片段数」。
pub fn status(state: &DbState, project_id: &str) -> Result<RagStatus, AppError> {
    let local_only = local_only_project(state, project_id)?;
    let conn = state.biz();
    let (chunks, indexed_at): (i64, Option<String>) = conn
        .query_row(
            "select count(*), max(indexed_at) from rag_chunk where project_id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(AppError::from)?;
    // 索引之后设定或正文又改过 → 过期。时间格式统一为 ISO8601，可直接比较字符串。
    let latest: Option<String> = conn
        .query_row(
            "select max(updated_at) from (
                select updated_at from chapter where project_id = ?1
                union all
                select updated_at from story_element where project_id = ?1
            )",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    drop(conn);

    // 索引之后内容改过 → 过期；换了检索模型 → 同样要重建（向量空间变了）。
    let content_changed = match (&indexed_at, &latest) {
        (Some(indexed), Some(latest)) => latest > indexed,
        (None, Some(_)) => true,
        _ => false,
    };
    let indexed_model = setting::get(state, INDEXED_MODEL_KEY)?;
    let current_model = embed::resolve_target_for(state, local_only)
        .ok()
        .map(|target| target.reference);
    let model_changed = chunks > 0
        && matches!(
            (&indexed_model, &current_model),
            (Some(indexed), Some(current)) if indexed != current
        );

    Ok(RagStatus {
        chunks,
        indexed_at,
        dim: current_dim(state)?,
        // 界面里显示「实际建索引时用的模型」，比显示当前选择更有意义。
        model: indexed_model.or(current_model.clone()),
        stale: content_changed || model_changed,
        embedding_ready: current_model.is_some(),
    })
}

/// 全量重建某作品的索引。embedding 先算完再动库，算失败时旧索引还在。
pub async fn reindex(state: &DbState, project_id: &str) -> Result<RagStatus, AppError> {
    let drafts = collect_chunks(state, project_id)?;
    if drafts.is_empty() {
        clear_chunks(state, project_id, false)?;
        return status(state, project_id);
    }

    let local_only = local_only_project(state, project_id)?;
    let texts: Vec<String> = drafts.iter().map(|draft| draft.content.clone()).collect();
    let embedded = embed::embed_texts(state, &texts, local_only).await?;
    if embedded.vectors.len() != drafts.len() {
        return Err(AppError::internal(format!(
            "embedding 返回 {} 条向量，但片段有 {} 条",
            embedded.vectors.len(),
            drafts.len()
        )));
    }
    // 不用 `vectors[0]`：上游返回空数组时下标会 panic，这里退化成 0 走下面的报错分支。
    let dim = embedded.vectors.first().map(|v| v.len()).unwrap_or(0) as i64;
    if dim <= 0 {
        return Err(AppError::internal("embedding 返回空向量，无法建立索引"));
    }

    let rebuilt = ensure_vec_table(state, dim)?;
    // 清旧片段与写新片段在同一个事务里完成：中途失败时旧索引仍然可用。
    // 维度变了要整表重建，此时其它作品的旧向量已不存在，它们的片段也必须一起清掉。
    replace_chunks(state, project_id, &drafts, &embedded.vectors, rebuilt)?;
    // 记下这次用的是哪个模型：换模型后 status 会提示「需要重建」。
    setting::set(state, INDEXED_MODEL_KEY, &embedded.reference)?;
    status(state, project_id)
}

/// 用一句话检索相关片段。未建索引、问题为空都返回空数组，不算错误。
pub async fn search(
    state: &DbState,
    project_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<RagHit>, AppError> {
    let query = query.trim();
    if query.is_empty() || !vec_table_exists(state)? {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, MAX_LIMIT);

    let local_only = local_only_project(state, project_id)?;
    let embedded = embed::embed_texts(state, &[query.to_string()], local_only).await?;
    let dim = embedded.vectors[0].len() as i64;
    if current_dim(state)? != Some(dim) {
        return Err(AppError::validation("检索模型已更换，请先重建索引"));
    }

    let candidates = knn(state, &embedded.vectors[0], limit)?;
    load_hits(state, project_id, &candidates, limit)
}

/// 收集某作品要索引的内容：设定条目一条一段，章节正文按段落聚合。
fn collect_chunks(state: &DbState, project_id: &str) -> Result<Vec<ChunkDraft>, AppError> {
    let conn = state.biz();
    let mut drafts: Vec<ChunkDraft> = Vec::new();

    let mut stmt = conn
        .prepare(
            "select id, kind, name, summary, detail_json from story_element where project_id = ?1",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (id, kind, name, summary, detail_json) = row.map_err(AppError::from)?;
        let content = chunk::element_text(&kind, &name, &summary, &detail_json);
        if content.trim().is_empty() {
            continue;
        }
        drafts.push(ChunkDraft {
            kind: "element".into(),
            source_id: id,
            title: name,
            content,
        });
    }
    drop(stmt);

    let mut stmt = conn
        .prepare("select id, act, title, content from chapter where project_id = ?1 and content <> ''")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (id, act, title, content) = row.map_err(AppError::from)?;
        let text = chunk::extract_text(&content);
        for piece in chunk::split_chunks(&text) {
            drafts.push(ChunkDraft {
                kind: "chapter".into(),
                source_id: id.clone(),
                // 标题带上幕次，检索结果的「来源」才有辨识度。
                title: format!("第{act}幕 · {title}"),
                content: piece,
            });
        }
    }

    Ok(drafts)
}

/// 用新片段整体替换索引（`all_projects` 为真时连同其它作品的旧片段一起清）。
///
/// `rag_chunk` 与 `vec_rag` 同处一个数据库文件，所以能放进**同一个事务**：
/// 要么「旧片段旧向量一起消失、新的一起写入」，要么什么都不变。
/// 早期实现用两条连接先清后写，中途失败会让索引彻底丢掉且无法恢复。
fn replace_chunks(
    state: &DbState,
    project_id: &str,
    drafts: &[ChunkDraft],
    vectors: &[Vec<f32>],
    all_projects: bool,
) -> Result<(), AppError> {
    if drafts.len() != vectors.len() {
        return Err(AppError::internal(format!(
            "片段与向量数量不一致：{} 段 / {} 条向量",
            drafts.len(),
            vectors.len()
        )));
    }
    let mut conn = state.biz();
    let tx = conn.transaction().map_err(AppError::from)?;
    let old_ids = collect_ids(&tx, all_projects, project_id)?;
    delete_rows(&tx, &old_ids)?;
    for (draft, vector) in drafts.iter().zip(vectors.iter()) {
        tx.execute(
            "insert into rag_chunk (project_id, kind, source_id, title, content, indexed_at)
             values (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![
                project_id,
                draft.kind,
                draft.source_id,
                draft.title,
                draft.content
            ],
        )
        .map_err(AppError::from)?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "insert into vec_rag (rowid, embedding) values (?1, ?2)",
            params![id, vector_literal(vector)],
        )
        .map_err(AppError::from)?;
    }
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

/// 清空片段。`all` 为真时连通所有作品一起清（向量表刚重建，旧向量已不存在）。
fn clear_chunks(state: &DbState, project_id: &str, all: bool) -> Result<(), AppError> {
    let mut conn = state.biz();
    let tx = conn.transaction().map_err(AppError::from)?;
    let ids = collect_ids(&tx, all, project_id)?;
    delete_rows(&tx, &ids)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

/// 删除某个源（章节正文 / 设定条目）留下的索引片段。
///
/// `rag_chunk.source_id` 是裸 TEXT，没有外键约束：删章节、删设定条目都不会自动清理，
/// 不清理的话被删掉的正文仍会作为「参考资料」被检索出来（既是错误结果也是隐私问题）。
/// 向量与片段必须一起删，只删一边会留下孤儿数据。
pub fn purge_source(state: &DbState, source_id: &str) -> Result<(), AppError> {
    purge_where(state, "source_id = ?1", params![source_id])
}

/// 删除整部作品的索引。
///
/// 删作品时 `rag_chunk` 靠外键级联走了，但 `vec_rag` 没有外键，必须在 project
/// 被删之前先清向量，否则 rowid 再也对不上，残留向量永远无法回收。
pub fn purge_project(state: &DbState, project_id: &str) -> Result<(), AppError> {
    purge_where(state, "project_id = ?1", params![project_id])
}

/// 按条件删片段：查询、删向量、删片段都在一个事务里完成。
/// `cond` 只允许传本文件内的字面量（不接收外部输入），因此这里的 `format!` 不构成注入面。
fn purge_where<P: rusqlite::Params>(
    state: &DbState,
    cond: &str,
    params: P,
) -> Result<(), AppError> {
    let mut conn = state.biz();
    let tx = conn.transaction().map_err(AppError::from)?;
    let ids = {
        let sql = format!("select id from rag_chunk where {cond}");
        let mut stmt = tx.prepare(&sql).map_err(AppError::from)?;
        let rows = stmt
            .query_map(params, |row| row.get::<_, i64>(0))
            .map_err(AppError::from)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?
    };
    delete_rows(&tx, &ids)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

fn collect_ids(
    conn: &rusqlite::Connection,
    all: bool,
    project_id: &str,
) -> Result<Vec<i64>, AppError> {
    if all {
        let mut stmt = conn
            .prepare("select id from rag_chunk")
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(AppError::from)?;
        return rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from);
    }
    let mut stmt = conn
        .prepare("select id from rag_chunk where project_id = ?1")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, i64>(0))
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 按 rowid 批量删向量与片段。向量表可能从未建过（没做过 embedding），此时跳过。
fn delete_rows(conn: &rusqlite::Connection, ids: &[i64]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    if vec_table_in(conn)? {
        let mut stmt = conn
            .prepare("delete from vec_rag where rowid = ?1")
            .map_err(AppError::from)?;
        for id in ids {
            stmt.execute(params![id]).map_err(AppError::from)?;
        }
    }
    let mut stmt = conn
        .prepare("delete from rag_chunk where id = ?1")
        .map_err(AppError::from)?;
    for id in ids {
        stmt.execute(params![id]).map_err(AppError::from)?;
    }
    Ok(())
}

/// 向量表是否存在（没做过 embedding 时不存在）。
fn vec_table_in(conn: &rusqlite::Connection) -> Result<bool, AppError> {
    let count: i64 = conn
        .query_row(
            "select count(*) from sqlite_master where name = 'vec_rag'",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    Ok(count > 0)
}

fn vec_table_exists(state: &DbState) -> Result<bool, AppError> {
    let conn = state.vec();
    let count: i64 = conn
        .query_row(
            "select count(*) from sqlite_master where name = 'vec_rag'",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    Ok(count > 0)
}

fn current_dim(state: &DbState) -> Result<Option<i64>, AppError> {
    Ok(setting::get(state, DIM_KEY)?.and_then(|value| value.trim().parse::<i64>().ok()))
}

/// 确保向量表存在且维度正确；返回「是否重建过」（重建意味着旧向量全丢）。
fn ensure_vec_table(state: &DbState, dim: i64) -> Result<bool, AppError> {
    if vec_table_exists(state)? && current_dim(state)? == Some(dim) {
        return Ok(false);
    }
    {
        let conn = state.vec();
        conn.execute_batch("drop table if exists vec_rag;")
            .map_err(AppError::from)?;
        conn.execute_batch(&format!(
            "create virtual table vec_rag using vec0(embedding float[{dim}]);"
        ))
        .map_err(AppError::from)?;
    }
    setting::set(state, DIM_KEY, &dim.to_string())?;
    Ok(true)
}

fn knn(state: &DbState, vector: &[f32], limit: usize) -> Result<Vec<(i64, f64)>, AppError> {
    let literal = vector_literal(vector);
    let conn = state.vec();
    let mut stmt = conn
        .prepare(
            "select rowid, distance from vec_rag
             where embedding match ?1 order by distance limit ?2",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![literal, limit as i64 * KNN_OVERSCAN], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(AppError::from)?;
    // 逐行错误必须上抛：静默跳过损坏行会让检索结果不完整，且故障完全不可见。
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

fn load_hits(
    state: &DbState,
    project_id: &str,
    candidates: &[(i64, f64)],
    limit: usize,
) -> Result<Vec<RagHit>, AppError> {
    let conn = state.biz();
    let mut hits = Vec::new();
    for (id, distance) in candidates {
        let row = conn
            .query_row(
                "select kind, title, content from rag_chunk where id = ?1 and project_id = ?2",
                params![id, project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(AppError::from)?;
        if let Some((kind, title, content)) = row {
            hits.push(RagHit {
                kind,
                title,
                content,
                distance: *distance,
            });
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(hits)
}

fn vector_literal(vector: &[f32]) -> String {
    let parts: Vec<String> = vector.iter().map(|value| value.to_string()).collect();
    format!("[{}]", parts.join(","))
}

#[cfg(test)]
mod tests;
