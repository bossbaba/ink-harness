//! RAG 索引与检索：把设定条目与章节正文切成片段、向量化后写入 vec0 表，
//! 提问时按问题向量取最近的若干片段，作为「参考资料」注入提示词。
//!
//! 两条连接分工：`rag_chunk`（业务库）存片段正文与来源，`vec_rag`（向量库）存向量，
//! rowid 一一对应。向量维度由 embedding 模型决定，换模型时整表重建（旧向量作废）。

use rusqlite::{OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{RagHit, RagStatus};
use crate::services::{embed, project, setting};

mod chunk;
mod vector;

use vector::{current_dim, ensure_vec_table, knn, vec_table_exists, vec_table_in, vector_literal};

/// 建索引时用的 embedding 模型；与该作品当前可用的模型不一致说明索引该重建。
fn indexed_model_key(project_id: &str) -> String {
    format!("rag_indexed_model:{project_id}")
}

/// 「会影响检索内容」的写入计数器：正文、章节标题/幕次、设定条目每次改动 +1。
///
/// 之前用「内容 updated_at > 索引 indexed_at」判断过期，两者都是毫秒精度，
/// 同一毫秒内的「保存 + 建索引」会漏判成新鲜。计数器没有精度问题，也不受系统时间回拨影响。
fn content_epoch_key(project_id: &str) -> String {
    format!("rag_content_epoch:{project_id}")
}

/// 上次建索引时看到的内容纪元；与当前纪元不同即索引过期。
fn index_epoch_key(project_id: &str) -> String {
    format!("rag_index_epoch:{project_id}")
}

/// 升级前的全局键。纪元与模型标记当时只有一份，多作品下会互相污染：
/// 重建 A 的索引会写全局 `rag_index_epoch`，把 B「内容已改」的状态顺带抹掉，
/// B 于是被判成新鲜、继续拿旧正文当参考资料。现在按作品分键，
/// 作品级键从未写过时回退读旧键，让老库的过期状态在升级后依然成立。
const LEGACY_CONTENT_EPOCH_KEY: &str = "content_epoch";
const LEGACY_INDEX_EPOCH_KEY: &str = "rag_index_epoch";
const LEGACY_INDEXED_MODEL_KEY: &str = "rag_indexed_model";
const MAX_LIMIT: usize = 20;
/// 未显式指定时注入的参考片段数，产品口径放在 service 层，命令层只透传。
const DEFAULT_LIMIT: usize = 5;

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

/// 在调用方的事务里递增某作品的内容纪元。
///
/// 所有会改变检索内容的写入（正文保存、章节标题/幕次、设定条目）都要调用它；
/// 和业务写入放同一个事务，避免「内容改了但纪元没动」导致索引被判成新鲜。
/// `project_id` 必须带上：纪元按作品分键，否则别的作品重建索引会把这里的改动抹平。
pub(crate) fn bump_content_epoch(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<(), AppError> {
    conn.execute(
        "insert into app_meta(key, value) values (?1, '1')
         on conflict(key) do update set value = cast(cast(value as integer) + 1 as text)",
        params![content_epoch_key(project_id)],
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// 读纪元计数器；没写过返回 None，由调用方决定回退旧键还是按 0 处理。
fn read_epoch(conn: &rusqlite::Connection, key: &str) -> Result<Option<i64>, AppError> {
    let value: Option<String> = conn
        .query_row(
            "select value from app_meta where key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    Ok(value.and_then(|raw| raw.trim().parse::<i64>().ok()))
}

/// 读作品级纪元；作品级键从未写过时回退到升级前的全局键。
fn read_epoch_for(
    conn: &rusqlite::Connection,
    scoped_key: &str,
    legacy_key: &str,
) -> Result<i64, AppError> {
    if let Some(value) = read_epoch(conn, scoped_key)? {
        return Ok(value);
    }
    Ok(read_epoch(conn, legacy_key)?.unwrap_or(0))
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
    // 内容纪元：任何影响检索的写入都会 +1，与建索引时记下的纪元不同就是过期。
    // 用计数器而不是比较时间戳，避免「同一毫秒内保存 + 建索引」漏判。
    // 纪元按作品分键，本作品的改动不会让别的作品误判过期（反之亦然）。
    let content_epoch = read_epoch_for(
        &conn,
        &content_epoch_key(project_id),
        LEGACY_CONTENT_EPOCH_KEY,
    )?;
    let index_epoch = read_epoch_for(&conn, &index_epoch_key(project_id), LEGACY_INDEX_EPOCH_KEY)?;
    drop(conn);

    // 索引之后内容改过 → 过期；换了检索模型 → 同样要重建（向量空间变了）。
    let content_changed = content_epoch > index_epoch;
    // 模型标记同样按作品分键：重建 A 的索引不能替 B 宣告「模型已对齐」。
    let indexed_model = setting::get(state, &indexed_model_key(project_id))?
        .or(setting::get(state, LEGACY_INDEXED_MODEL_KEY)?);
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
    // 先记下动手前的内容纪元：索引期间作者又改了正文时纪元会继续增长，
    // 建完仍然会被判成过期（宁可提示再建一次，也不要用旧内容的索引冒充新鲜）。
    let epoch = {
        let conn = state.biz();
        read_epoch_for(
            &conn,
            &content_epoch_key(project_id),
            LEGACY_CONTENT_EPOCH_KEY,
        )?
    };
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
    if rebuilt {
        // 换模型导致向量表重建时，其它作品的向量已经被物理删掉。
        // 先把所有片段清空并单独提交，再写当前作品：这样即便随后写库失败，
        // 也不会有项目顶着「有片段、无向量」被误判成新鲜索引（宁可显示未建索引）。
        clear_chunks(state, project_id, true)?;
    }
    // 清旧片段与写新片段在同一个事务里完成：中途失败时旧索引仍然可用。
    replace_chunks(state, project_id, &drafts, &embedded.vectors, false)?;
    // 记下这次用的是哪个模型：换模型后 status 会提示「需要重建」。
    setting::set(state, &indexed_model_key(project_id), &embedded.reference)?;
    // 记下这次索引覆盖到的内容纪元，status 据此判断是否过期。
    setting::set(state, &index_epoch_key(project_id), &epoch.to_string())?;
    status(state, project_id)
}

/// 用一句话检索相关片段。未建索引、问题为空都返回空数组，不算错误。
pub async fn search(
    state: &DbState,
    project_id: &str,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<RagHit>, AppError> {
    let query = query.trim();
    if query.is_empty() || !vec_table_exists(state)? {
        return Ok(Vec::new());
    }
    // 索引过期时直接返回空：正文改过之后旧片段就是错的参考资料，
    // 宁可让 AI 只用大纲上下文，也不能拿旧正文去续写（前端会显示 stale 提示）。
    if status(state, project_id)?.stale {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

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
        .prepare(
            "select id, act, title, content from chapter where project_id = ?1 and content <> ''",
        )
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

/// 在调用方已经开启的事务里清掉某个来源的片段与向量。
///
/// `rag_chunk.source_id` 是裸 TEXT，没有外键约束：删章节、删设定条目都不会自动清理，
/// 不清理的话被删掉的正文仍会作为「参考资料」被检索出来（既是错误结果也是隐私问题）。
/// 清理必须复用业务删除自己的事务：先提交删除再清索引的话，清理失败只能记日志、
/// 等下次启动兜底，这期间已经删掉的正文仍可能被检索出来。
///
/// 不再提供「自己开事务」的版本：清理逻辑只有这一条路径，
/// 避免以后有人绕过事务调用，又把原子性丢掉。
pub(crate) fn purge_source_in(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<(), AppError> {
    delete_by_cond(conn, "source_id = ?1", params![source_id])
}

/// 同上，按作品清（删作品时与 `delete from project` 放同一事务）。
///
/// 删作品时 `rag_chunk` 靠外键级联走了，但 `vec_rag` 没有外键，必须在 project
/// 被删之前先清向量，否则 rowid 再也对不上，残留向量永远无法回收。
pub(crate) fn purge_project_in(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<(), AppError> {
    delete_by_cond(conn, "project_id = ?1", params![project_id])
}

/// 按条件删片段：先查出 rowid，再删向量、删片段。
///
/// 事务由调用方负责（业务删除直接复用它的写事务）。
/// `cond` 只允许传本文件内的字面量（不接收外部输入），因此这里的 `format!` 不构成注入面。
fn delete_by_cond<P: rusqlite::Params>(
    conn: &rusqlite::Connection,
    cond: &str,
    params: P,
) -> Result<(), AppError> {
    let ids = {
        let sql = format!("select id from rag_chunk where {cond}");
        let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
        let rows = stmt
            .query_map(params, |row| row.get::<_, i64>(0))
            .map_err(AppError::from)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?
    };
    delete_rows(conn, &ids)?;
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

#[cfg(test)]
mod tests;
/// 状态判定、全量清理、脏数据容错等边界用例，与主链路用例分文件（单文件行数上限）。
#[cfg(test)]
mod tests_bounds;
