//! RAG 索引与检索：把设定条目与章节正文切成片段、向量化后写入 vec0 表，
//! 提问时按问题向量取最近的若干片段，作为「参考资料」注入提示词。
//!
//! 两条连接分工：`rag_chunk`（业务库）存片段正文与来源，`vec_rag`（向量库）存向量，
//! rowid 一一对应。向量维度由 embedding 模型决定，换模型时整表重建（旧向量作废）。

use rusqlite::{params, OptionalExtension};

use crate::infrastructure::db::DbState;
use crate::models::{RagHit, RagStatus};
use crate::services::{embed, setting};

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
/// 建索引与检索都要把正文（片段或问题）发给 embedding 服务，
/// 仅本地作品只能走本地 Provider，否则等于绕过隐私分级。
/// 作品不存在时按「不限制」处理，后续查询自己会报找不到数据。
fn local_only_project(state: &DbState, project_id: &str) -> Result<bool, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let privacy: Option<String> = conn
        .query_row("select privacy from project where id = ?1", params![project_id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(privacy.as_deref() == Some("local-only"))
}

/// 某作品的索引状态；前端据此提示「未建索引 / 索引过期 / 片段数」。
pub fn status(state: &DbState, project_id: &str) -> Result<RagStatus, String> {
    let local_only = local_only_project(state, project_id)?;
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let (chunks, indexed_at): (i64, Option<String>) = conn
        .query_row(
            "select count(*), max(indexed_at) from rag_chunk where project_id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
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
pub async fn reindex(state: &DbState, project_id: &str) -> Result<RagStatus, String> {
    let drafts = collect_chunks(state, project_id)?;
    if drafts.is_empty() {
        clear_chunks(state, project_id, false)?;
        return status(state, project_id);
    }

    let local_only = local_only_project(state, project_id)?;
    let texts: Vec<String> = drafts.iter().map(|draft| draft.content.clone()).collect();
    let embedded = embed::embed_texts(state, &texts, local_only).await?;
    if embedded.vectors.len() != drafts.len() {
        return Err(format!(
            "embedding 返回 {} 条向量，但片段有 {} 条",
            embedded.vectors.len(),
            drafts.len()
        ));
    }
    let dim = embedded.vectors[0].len() as i64;
    if dim <= 0 {
        return Err("embedding 返回空向量，无法建立索引".into());
    }

    let rebuilt = ensure_vec_table(state, dim)?;
    // 维度变了只能整表重建：其他作品的旧向量已经没了，它们的 chunk 也必须一起清掉。
    clear_chunks(state, project_id, rebuilt)?;
    write_chunks(state, project_id, &drafts, &embedded.vectors)?;
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
) -> Result<Vec<RagHit>, String> {
    let query = query.trim();
    if query.is_empty() || !vec_table_exists(state)? {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, MAX_LIMIT);

    let local_only = local_only_project(state, project_id)?;
    let embedded = embed::embed_texts(state, &[query.to_string()], local_only).await?;
    let dim = embedded.vectors[0].len() as i64;
    if current_dim(state)? != Some(dim) {
        return Err("检索模型已更换，请先重建索引".into());
    }

    let candidates = knn(state, &embedded.vectors[0], limit)?;
    load_hits(state, project_id, &candidates, limit)
}

/// 收集某作品要索引的内容：设定条目一条一段，章节正文按段落聚合。
fn collect_chunks(state: &DbState, project_id: &str) -> Result<Vec<ChunkDraft>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let mut drafts: Vec<ChunkDraft> = Vec::new();

    let mut stmt = conn
        .prepare(
            "select id, kind, name, summary, detail_json from story_element where project_id = ?1",
        )
        .map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, kind, name, summary, detail_json) = row.map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, act, title, content) = row.map_err(|e| e.to_string())?;
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

fn write_chunks(
    state: &DbState,
    project_id: &str,
    drafts: &[ChunkDraft],
    vectors: &[Vec<f32>],
) -> Result<(), String> {
    let mut ids: Vec<i64> = Vec::with_capacity(drafts.len());
    {
        let conn = state.biz.lock().map_err(|e| e.to_string())?;
        for draft in drafts {
            conn.execute(
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
            .map_err(|e| e.to_string())?;
            ids.push(conn.last_insert_rowid());
        }
    }

    let conn = state.vec.lock().map_err(|e| e.to_string())?;
    for (id, vector) in ids.iter().zip(vectors.iter()) {
        conn.execute(
            "insert into vec_rag (rowid, embedding) values (?1, ?2)",
            params![id, vector_literal(vector)],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 清空片段。`all` 为真时连通所有作品一起清（向量表刚重建，旧向量已不存在）。
fn clear_chunks(state: &DbState, project_id: &str, all: bool) -> Result<(), String> {
    let ids: Vec<i64> = {
        let conn = state.biz.lock().map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        if all {
            let mut stmt = conn.prepare("select id from rag_chunk").map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                ids.push(row.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn
                .prepare("select id from rag_chunk where project_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![project_id], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                ids.push(row.map_err(|e| e.to_string())?);
            }
        }
        ids
    };

    {
        let conn = state.vec.lock().map_err(|e| e.to_string())?;
        for id in &ids {
            conn.execute("delete from vec_rag where rowid = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
    }

    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    if all {
        conn.execute("delete from rag_chunk", [])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "delete from rag_chunk where project_id = ?1",
            params![project_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn vec_table_exists(state: &DbState) -> Result<bool, String> {
    let conn = state.vec.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "select count(*) from sqlite_master where name = 'vec_rag'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

fn current_dim(state: &DbState) -> Result<Option<i64>, String> {
    Ok(setting::get(state, DIM_KEY)?.and_then(|value| value.trim().parse::<i64>().ok()))
}

/// 确保向量表存在且维度正确；返回「是否重建过」（重建意味着旧向量全丢）。
fn ensure_vec_table(state: &DbState, dim: i64) -> Result<bool, String> {
    if vec_table_exists(state)? && current_dim(state)? == Some(dim) {
        return Ok(false);
    }
    {
        let conn = state.vec.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("drop table if exists vec_rag;")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(&format!(
            "create virtual table vec_rag using vec0(embedding float[{dim}]);"
        ))
        .map_err(|e| e.to_string())?;
    }
    setting::set(state, DIM_KEY, &dim.to_string())?;
    Ok(true)
}

fn knn(state: &DbState, vector: &[f32], limit: usize) -> Result<Vec<(i64, f64)>, String> {
    let literal = vector_literal(vector);
    let conn = state.vec.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "select rowid, distance from vec_rag
             where embedding match ?1 order by distance limit ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![literal, limit as i64 * KNN_OVERSCAN], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn load_hits(
    state: &DbState,
    project_id: &str,
    candidates: &[(i64, f64)],
    limit: usize,
) -> Result<Vec<RagHit>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
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
            .map_err(|e| e.to_string())?;
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
