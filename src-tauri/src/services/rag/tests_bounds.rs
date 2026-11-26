//! RAG 的边界用例：状态判定、检索提前返回、全量清理、脏数据容错。
//!
//! 与 `tests.rs` 分开是因为单文件有行数上限；这里全部离线运行，
//! 只操作临时库，不发任何 embedding 请求。

use super::tests::{
    draft, purge_source_now, seed_project, seed_provider, temp_state, write_chunks,
};
use super::*;

/// 读业务库里某个统计 SQL 的结果；只用于断言清理是否彻底。
fn count_biz(state: &DbState, sql: &str) -> i64 {
    let conn = state.biz();
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

/// 读所有向量表行数之和：按维度分表后每张表都可能在用，清片段必须逐张生效。
/// vec0 虚拟表必须走加载了扩展的连接，业务连接打不开它。
fn count_vec(state: &DbState) -> i64 {
    let conn = state.vec();
    let mut total = 0;
    for name in crate::infrastructure::db::all_vec_table_names(&conn).unwrap() {
        let sql = format!("select count(*) from {name}");
        total += conn.query_row(&sql, [], |row| row.get::<_, i64>(0)).unwrap();
    }
    total
}

/// status 是前端「未建索引 / 索引过期」提示的唯一依据：
/// 片段数、维度、建索引时的模型、内容纪元都必须如实反映。
///
/// 同时是 D-36 的回归：判定用整数纪元而不是毫秒时间戳，
/// 「同一毫秒内保存 + 建索引」既不会漏判，也不会把刚建好的索引误报成过期。
#[test]
fn status_reports_chunks_dim_and_staleness() {
    let (state, dir) = temp_state("status");
    seed_project(&state, "p-1");

    // 空作品：没建过向量表、没有片段，不算过期。
    let empty = status(&state, "p-1").unwrap();
    assert_eq!(empty.chunks, 0);
    assert_eq!(empty.dim, None);
    assert!(empty.indexed_at.is_none());
    assert!(!empty.stale, "没建过索引的作品不该提示「过期」");

    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("墨白", "少年剑客")],
        &[vec![1.0, 0.0, 0.0]],
    )
    .unwrap();

    let indexed = status(&state, "p-1").unwrap();
    assert_eq!(indexed.chunks, 1);
    assert_eq!(indexed.dim, Some(3));
    assert!(indexed.indexed_at.is_some());
    assert!(!indexed.stale, "刚写完、纪元相同，不该判过期");

    // 正文改过但没重建索引：内容纪元前进 → 提示过期。
    {
        let conn = state.biz();
        bump_content_epoch(&conn, "p-1").unwrap();
    }
    assert!(
        status(&state, "p-1").unwrap().stale,
        "内容纪元前进就该判过期"
    );

    // 重建索引会记下当时的纪元，过期标记随之消失。
    crate::services::setting::set(&state, &index_epoch_key("p-1"), "1").unwrap();
    assert!(!status(&state, "p-1").unwrap().stale);

    // 换了检索模型 → 向量空间不可比，同样要提示重建；
    // 同时界面展示的应当是「建索引时的模型」而不是当前选择。
    seed_provider(&state, "local-embed", "local", "nomic-embed-text");
    crate::services::setting::set(&state, &indexed_model_key("p-1"), "旧模型:x").unwrap();
    let changed = status(&state, "p-1").unwrap();
    assert!(changed.stale, "换模型后必须重建索引");
    assert_eq!(changed.model.as_deref(), Some("旧模型:x"));
    assert!(changed.embedding_ready);
    std::fs::remove_dir_all(&dir).ok();
}

/// search 的三条提前返回路径都不该碰 embedding 服务：
/// 空问题、从没建过向量表、索引已过期。这样离线也能验证兜底逻辑。
#[tokio::test]
async fn search_short_circuits_before_embedding() {
    let (state, dir) = temp_state("search-guard");
    seed_project(&state, "p-1");

    assert!(
        search(&state, "p-1", "   ", Some(3))
            .await
            .unwrap()
            .is_empty(),
        "空问题不检索"
    );
    assert!(
        search(&state, "p-1", "墨白", Some(3))
            .await
            .unwrap()
            .is_empty(),
        "没建过向量表时返回空而不是报错"
    );

    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("墨白", "少年剑客")],
        &[vec![1.0, 0.0, 0.0]],
    )
    .unwrap();
    {
        let conn = state.biz();
        bump_content_epoch(&conn, "p-1").unwrap();
    }
    assert!(
        search(&state, "p-1", "墨白", Some(3))
            .await
            .unwrap()
            .is_empty(),
        "索引过期时宁可返回空，也不能拿旧正文当参考资料"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// 作品内容被删光后重建索引：没有片段可写，但要顺手清掉旧索引，
/// 否则已删除的正文仍会被检索出来。
#[tokio::test]
async fn reindex_without_source_content_clears_index() {
    let (state, dir) = temp_state("reindex-empty");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("墨白", "少年剑客")],
        &[vec![1.0, 0.0, 0.0]],
    )
    .unwrap();

    // 库里没有 story_element / chapter，collect_chunks 必为空，走「清空」分支，
    // 这条路径不会发任何 embedding 请求。
    let rebuilt = reindex(&state, "p-1").await.unwrap();
    assert_eq!(rebuilt.chunks, 0);
    assert_eq!(count_biz(&state, "select count(*) from rag_chunk"), 0);
    assert!(
        knn(&state, &[1.0, 0.0, 0.0], 3).unwrap().is_empty(),
        "旧向量也要一起清掉"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// 片段与向量数量不一致必须直接报错：错位写入会让正文和向量对不上，
/// 检索出来的片段与语义完全无关。
#[test]
fn replace_chunks_rejects_count_mismatch() {
    let (state, dir) = temp_state("mismatch");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("墨白", "少年剑客")],
        &[vec![1.0, 0.0, 0.0]],
    )
    .unwrap();

    let result = replace_chunks(
        &state,
        "p-1",
        &[draft("甲", "A"), draft("乙", "B")],
        &[vec![0.0, 1.0, 0.0]],
        false,
        3,
    );
    assert!(result.is_err(), "数量不一致应当报错");

    // 报错发生在开事务之前，旧索引必须原样可用。
    let candidates = knn(&state, &[1.0, 0.0, 0.0], 3).unwrap();
    let hits = load_hits(&state, "p-1", &candidates, 3).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "墨白");
    std::fs::remove_dir_all(&dir).ok();
}

/// 全量清理要跨作品生效，且每张维度表里的对应向量都要删掉，
/// 否则会留下「有片段、无向量」的作品被 status 误判成索引新鲜。
#[test]
fn clear_chunks_all_clears_every_project() {
    let (state, dir) = temp_state("clear-all");
    seed_project(&state, "p-1");
    seed_project(&state, "p-2");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(&state, "p-1", &[draft("甲", "A")], &[vec![1.0, 0.0, 0.0]]).unwrap();
    write_chunks(&state, "p-2", &[draft("乙", "B")], &[vec![0.0, 1.0, 0.0]]).unwrap();

    purge::clear_chunks(&state, "p-1", true).unwrap();

    assert_eq!(
        count_biz(&state, "select count(*) from rag_chunk"),
        0,
        "all=true 要跨作品清"
    );
    assert_eq!(count_vec(&state), 0, "片段清了向量也必须清");
    assert!(knn(&state, &[1.0, 0.0, 0.0], 3).unwrap().is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

/// 换 embedding 模型导致维度变化时，旧维度表必须原样保留：
/// 其它作品可能还用它检索，切回旧模型也不该要求重建。
#[test]
fn rebuilding_vec_table_keeps_old_dimension_vectors() {
    let (state, dir) = temp_state("rebuild");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("甲", "A"), draft("乙", "B")],
        &[vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0]],
    )
    .unwrap();

    ensure_vec_table(&state, 4).unwrap();
    {
        let conn = state.vec();
        assert!(vector::vec_table_in(&conn, 3).unwrap(), "3 维表必须保留");
        assert!(vector::vec_table_in(&conn, 4).unwrap(), "4 维表已建立");
    }
    assert_eq!(count_vec(&state), 2, "旧向量仍在 3 维表里");
    assert_eq!(
        count_biz(&state, "select count(*) from rag_chunk"),
        2,
        "片段表不受影响"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// 换维度重建 A 的索引后，B 仍能从自己的维度表检索到片段（D-33 的核心场景）。
#[test]
fn dimension_switch_keeps_other_project_searchable() {
    let (state, dir) = temp_state("dim-isolation");
    seed_project(&state, "p-1");
    seed_project(&state, "p-2");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(&state, "p-1", &[draft("甲", "A")], &[vec![1.0, 0.0, 0.0]]).unwrap();
    {
        let conn = state.biz();
        setting::set_in(&conn, &indexed_dim_key("p-1"), "3").unwrap();
    }

    // 换成 4 维建新表；老作品的表、片段与维度记录都不能被动过。
    ensure_vec_table(&state, 4).unwrap();
    write_chunks(&state, "p-2", &[draft("乙", "B")], &[vec![1.0, 0.0, 0.0, 0.0]]).unwrap();
    {
        let conn = state.biz();
        setting::set_in(&conn, &indexed_dim_key("p-2"), "4").unwrap();
    }

    let conn = state.vec();
    assert!(vector::vec_table_in(&conn, 3).unwrap());
    drop(conn);
    let hits = load_hits(&state, "p-1", &knn(&state, &[1.0, 0.0, 0.0], 3).unwrap(), 3).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "甲");
    assert_eq!(status(&state, "p-1").unwrap().dim, Some(3));
    assert_eq!(status(&state, "p-2").unwrap().dim, Some(4));
    std::fs::remove_dir_all(&dir).ok();
}

/// 删除不存在的来源必须幂等：章节/设定被重复删除不能报错，也不能误伤别的来源。
#[test]
fn purge_unknown_source_is_noop() {
    let (state, dir) = temp_state("purge-noop");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("甲", "A"), draft("乙", "B")],
        &[vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0]],
    )
    .unwrap();

    purge_source_now(&state, "src-不存在");
    purge_source_now(&state, "src-不存在");

    assert_eq!(count_biz(&state, "select count(*) from rag_chunk"), 2);
    assert_eq!(count_vec(&state), 2);
    std::fs::remove_dir_all(&dir).ok();
}

/// 从没做过 embedding 的库没有 vec_rag 表，删片段时不能因此报错。
#[test]
fn purge_works_without_vec_table() {
    let (state, dir) = temp_state("purge-novec");
    seed_project(&state, "p-1");
    {
        let conn = state.biz();
        conn.execute(
            "insert into rag_chunk (project_id, kind, source_id, title, content, indexed_at)
             values ('p-1', 'element', 'src-甲', '甲', 'A', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .unwrap();
    }

    purge_source_now(&state, "src-甲");
    assert_eq!(count_biz(&state, "select count(*) from rag_chunk"), 0);
    std::fs::remove_dir_all(&dir).ok();
}

/// 向量表比片段表多出孤儿行时（历史脏数据），load_hits 要跳过而不是报错；
/// limit 只统计真正取到正文的命中，且必须按作品过滤。
#[test]
fn load_hits_skips_orphans_and_respects_limit() {
    let (state, dir) = temp_state("load-hits");
    seed_project(&state, "p-1");
    seed_project(&state, "p-2");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(
        &state,
        "p-1",
        &[draft("甲", "A"), draft("乙", "B"), draft("丙", "C")],
        &[
            vec![1.0, 0.0, 0.0],
            vec![0.9, 0.1, 0.0],
            vec![0.8, 0.2, 0.0],
        ],
    )
    .unwrap();
    // 造一条指向不存在片段的向量，距离最近，会排在候选最前面。
    {
        let conn = state.vec();
        conn.execute(
            "insert into vec_rag_3 (rowid, embedding) values (999999, '[1,0,0]')",
            [],
        )
        .unwrap();
    }

    let candidates = knn(&state, &[1.0, 0.0, 0.0], 5).unwrap();
    assert_eq!(candidates.len(), 4, "孤儿向量同样会被 KNN 命中");

    let hits = load_hits(&state, "p-1", &candidates, 2).unwrap();
    assert_eq!(hits.len(), 2, "limit 按取到正文的命中数计算");
    assert!(
        hits.iter()
            .all(|hit| ["甲", "乙", "丙"].contains(&hit.title.as_str()))
    );

    // 别的作品拿同一批候选去查：一条都不该返回。
    assert!(load_hits(&state, "p-2", &candidates, 5).unwrap().is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

/// collect_chunks 决定「索引里到底放什么」：设定一条一段、章节按段落切并带幕次，
/// 空正文的章节直接跳过。这条链路不发网络请求，可以离线验证。
#[test]
fn collect_chunks_reads_elements_and_chapters() {
    let (state, dir) = temp_state("collect");
    seed_project(&state, "p-1");
    {
        let conn = state.biz();
        conn.execute(
            "insert into story_element
             (id, project_id, kind, name, summary, detail_json, created_at, updated_at)
             values ('el-1', 'p-1', 'character', '墨白', '少年剑客', ?1,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![serde_json::json!({ "aliases": ["小墨"] }).to_string()],
        )
        .unwrap();
        let doc = serde_json::json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [
                { "type": "text", "text": "雨夜里，墨白提剑走进长街。" }
            ]}]
        });
        conn.execute(
            "insert into chapter
             (id, project_id, act, title, summary, status, content, word_count, created_at, updated_at)
             values ('ch-1', 'p-1', 1, '开端', '', 'drafting', ?1, 15,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![doc.to_string()],
        )
        .unwrap();
        // 空正文的章节在 SQL 里就被过滤掉，不该产生片段。
        conn.execute(
            "insert into chapter
             (id, project_id, act, title, summary, status, content, word_count, created_at, updated_at)
             values ('ch-2', 'p-1', 2, '空章', '', 'drafting', '', 0,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )
        .unwrap();
    }

    let drafts = collect_chunks(&state, "p-1").unwrap();
    assert_eq!(drafts.len(), 2, "一条设定 + 一段章节正文");

    assert_eq!(drafts[0].kind, "element");
    assert_eq!(drafts[0].source_id, "el-1");
    assert_eq!(drafts[0].title, "墨白");
    assert!(drafts[0].content.contains("少年剑客"));
    assert!(drafts[0].content.contains("别名：小墨"));

    assert_eq!(drafts[1].kind, "chapter");
    assert_eq!(drafts[1].source_id, "ch-1");
    assert_eq!(drafts[1].title, "第1幕 · 开端", "来源要带幕次才认得出");
    assert_eq!(drafts[1].content, "雨夜里，墨白提剑走进长街。");
    std::fs::remove_dir_all(&dir).ok();
}

/// 向量字面量是 sqlite-vec 唯一接受的入参格式：数字用 f32 的最短表示，不能带空格。
#[test]
fn vector_literal_formats_as_array() {
    assert_eq!(vector_literal(&[1.0, 0.5, -2.0]), "[1,0.5,-2]");
    assert_eq!(vector_literal(&[]), "[]");
}

// 纪元相关的两个用例已拆到 `tests_bounds_epoch.rs`，这里保留其余边界用例。
