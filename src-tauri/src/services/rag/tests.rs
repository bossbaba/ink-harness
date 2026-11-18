//! RAG 索引与检索的单测：不依赖网络，用假的向量直接验证写库、KNN 与项目隔离。

use super::*;
use crate::infrastructure::db;

fn temp_state(tag: &str) -> (DbState, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("ih-rag-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let state = db::open(&dir).unwrap();
    (state, dir)
}

/// 建一条作品记录，rag_chunk 靠外键挂着它。
fn seed_project(state: &DbState, id: &str) {
    let conn = state.biz();
    conn.execute(
        "insert into project (id, title, created_at, updated_at)
         values (?1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![id],
    )
    .unwrap();
}

/// 插一条 Provider，用于验证检索模型的隐私过滤（base_url 随便写，测试不会真的发请求）。
fn seed_provider(state: &DbState, id: &str, source: &str, model: &str) {
    let conn = state.biz();
    conn.execute(
        "insert or replace into provider_config
         (id, name, source, base_url, api_key_ref, enabled, models_json, updated_at)
         values (?1, ?1, ?2, 'http://127.0.0.1:1/v1', null, 1, ?3,
         strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![id, source, serde_json::json!([{ "id": model }]).to_string()],
    )
    .unwrap();
}

fn draft(title: &str, content: &str) -> ChunkDraft {
    ChunkDraft {
        kind: "element".into(),
        source_id: format!("src-{title}"),
        title: title.into(),
        content: content.into(),
    }
}

/// 测试专用的写入入口：默认只替换当前作品，不牵连别的作品。
fn write_chunks(
    state: &DbState,
    project_id: &str,
    drafts: &[ChunkDraft],
    vectors: &[Vec<f32>],
) -> Result<(), AppError> {
    replace_chunks(state, project_id, drafts, vectors, false)
}

#[test]
fn write_then_search_returns_chunk() {
    let (state, dir) = temp_state("write");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("墨白", "少年剑客")],
        &[vec![1.0, 0.0, 0.0]],
    )
    .unwrap();

    let candidates = knn(&state, &[1.0, 0.0, 0.0], 3).unwrap();
    let hits = load_hits(&state, "p-1", &candidates, 3).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "墨白");
    std::fs::remove_dir_all(&dir).ok();
}

/// 同库多作品时，别的作品的片段不能混进结果。
#[test]
fn search_is_scoped_to_project() {
    let (state, dir) = temp_state("scope");
    seed_project(&state, "p-1");
    seed_project(&state, "p-2");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(&state, "p-1", &[draft("甲", "A")], &[vec![1.0, 0.0, 0.0]]).unwrap();
    write_chunks(&state, "p-2", &[draft("乙", "B")], &[vec![1.0, 0.0, 0.0]]).unwrap();

    let candidates = knn(&state, &[1.0, 0.0, 0.0], 3).unwrap();
    let hits = load_hits(&state, "p-1", &candidates, 3).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "甲");

    // 重建 p-1 的索引只影响 p-1，p-2 的片段应当原样保留。
    clear_chunks(&state, "p-1", false).unwrap();
    let candidates = knn(&state, &[1.0, 0.0, 0.0], 3).unwrap();
    let remaining = load_hits(&state, "p-2", &candidates, 3).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].title, "乙");
    std::fs::remove_dir_all(&dir).ok();
}

/// 仅本地作品的内容不能被送去云端做向量化：选了云端 embedding 也不能用。
#[test]
fn local_only_project_rejects_cloud_embedding() {
    let (state, dir) = temp_state("local-only");
    seed_project(&state, "p-1");
    state
        .biz
        .lock()
        .unwrap()
        .execute("update project set privacy = 'local-only' where id = 'p-1'", [])
        .unwrap();
    seed_provider(&state, "cloud-embed", "remote", "text-embedding-3-small");

    assert!(
        crate::services::embed::resolve_target_for(&state, true).is_err(),
        "仅本地作品不能用云端 embedding"
    );
    assert!(!status(&state, "p-1").unwrap().embedding_ready);

    // 换成一条本地 embedding 后，同一作品就可以建索引了。
    seed_provider(&state, "local-embed", "local", "nomic-embed-text");
    let target = crate::services::embed::resolve_target_for(&state, true).unwrap();
    assert_eq!(target.reference, "local-embed:nomic-embed-text");
    let status = status(&state, "p-1").unwrap();
    assert!(status.embedding_ready);
    assert_eq!(status.model.as_deref(), Some("local-embed:nomic-embed-text"));
    std::fs::remove_dir_all(&dir).ok();
}

/// 维度变了必须换表，否则写进去就会报维度不匹配。
#[test]
fn ensure_vec_table_rebuilds_on_dim_change() {
    let (state, dir) = temp_state("dim");
    assert!(ensure_vec_table(&state, 3).unwrap(), "首次建表");
    assert!(!ensure_vec_table(&state, 3).unwrap(), "同维度不重建");
    assert!(ensure_vec_table(&state, 4).unwrap(), "换维度必须重建");
    assert_eq!(current_dim(&state).unwrap(), Some(4));
    std::fs::remove_dir_all(&dir).ok();
}

/// 删章节 / 删设定条目后必须把片段与向量一起清掉：
/// 只清一侧会留下孤儿数据，不清则已删除的正文还能被当成参考资料检索出来。
#[test]
fn purge_source_removes_chunk_and_vector() {
    let (state, dir) = temp_state("purge-source");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("甲", "A"), draft("乙", "B")],
        &[vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0]],
    )
    .unwrap();

    purge_source(&state, "src-甲").unwrap();

    // 片段与向量都要少一条：向量还在的话 KNN 会命中一个查不到正文的 rowid。
    let candidates = knn(&state, &[1.0, 0.0, 0.0], 3).unwrap();
    assert_eq!(candidates.len(), 1, "被删片段的向量也应清掉");
    let hits = load_hits(&state, "p-1", &candidates, 3).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "乙");
    std::fs::remove_dir_all(&dir).ok();
}

/// 删作品前要把该作品的向量清空：rag_chunk 靠外键级联，vec_rag 没有外键。
#[test]
fn purge_project_removes_all_vectors() {
    let (state, dir) = temp_state("purge-project");
    seed_project(&state, "p-1");
    seed_project(&state, "p-2");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(&state, "p-1", &[draft("甲", "A")], &[vec![1.0, 0.0, 0.0]]).unwrap();
    write_chunks(&state, "p-2", &[draft("乙", "B")], &[vec![0.0, 1.0, 0.0]]).unwrap();

    purge_project(&state, "p-1").unwrap();

    let candidates = knn(&state, &[1.0, 0.0, 0.0], 5).unwrap();
    assert_eq!(candidates.len(), 1, "只清被删作品的向量");
    let remaining = load_hits(&state, "p-2", &candidates, 5).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].title, "乙");
    std::fs::remove_dir_all(&dir).ok();
}

/// 手动验证用：需要本机 Ollama 正在运行且装好 nomic-embed-text。
/// `cargo test manual_embedding_roundtrip -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn manual_embedding_roundtrip() {
    let (state, dir) = temp_state("manual");
    seed_project(&state, "p-1");
    {
        let conn = state.biz();
        conn.execute(
            "insert or replace into provider_config
             (id, name, source, base_url, api_key_ref, enabled, models_json, updated_at)
             values ('ollama-local', '本地 Ollama', 'local', 'http://localhost:11434/v1', null, 1, ?1,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![
                r#"[{"id":"nomic-embed-text:latest","displayName":"nomic-embed-text","contextWindow":8192}]"#
            ],
        )
        .unwrap();
        conn.execute(
            "insert into story_element
             (id, project_id, kind, name, summary, detail_json, created_at, updated_at)
             values ('el-1', 'p-1', 'character', '墨白', '少年剑客', '{}',
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .unwrap();
        let doc = serde_json::json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [
                { "type": "text", "text": "雨夜里，墨白提剑走进长街，身后是追兵的火把。" }
            ]}]
        });
        conn.execute(
            "insert into chapter
             (id, project_id, act, title, summary, status, content, word_count, created_at, updated_at)
             values ('ch-1', 'p-1', 1, '开端', '', 'drafting', ?1, 20,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![doc.to_string()],
        )
        .unwrap();
    }

    let status = reindex(&state, "p-1").await.unwrap();
    println!("status = {status:?}");
    assert!(status.chunks >= 2, "设定与章节正文都应被索引");

    let hits = search(&state, "p-1", "提剑的人是谁", 3).await.unwrap();
    for hit in &hits {
        println!(
            "hit = {} / {:.4} / {}",
            hit.title, hit.distance, hit.content
        );
    }
    assert!(!hits.is_empty(), "应当检索到内容");
    std::fs::remove_dir_all(&dir).ok();
}
