//! RAG 纪元边界用例：作品级隔离与老库全局纪元回退。
//!
//! 从 `tests_bounds.rs` 拆出，只为守住单文件 500 行红线；两文件共用同一组临时库 helper。

use super::tests::{draft, seed_project, seed_provider, temp_state, write_chunks};
use super::*;

/// 索引纪元与模型标记必须按作品分键：多作品时重建 A 的索引不能把
/// B「内容已改」的状态顺带抹平，否则 B 会拿旧正文继续检索。
#[test]
fn index_state_is_scoped_per_project() {
    let (state, dir) = temp_state("epoch-scope");
    seed_project(&state, "p-1");
    seed_project(&state, "p-2");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(&state, "p-1", &[draft("甲", "A")], &[vec![1.0, 0.0, 0.0]]).unwrap();
    write_chunks(&state, "p-2", &[draft("乙", "B")], &[vec![0.0, 1.0, 0.0]]).unwrap();

    // 只改 p-2 的内容：只有 p-2 该被判成过期。
    {
        let conn = state.biz();
        bump_content_epoch(&conn, "p-2").unwrap();
    }
    assert!(
        !status(&state, "p-1").unwrap().stale,
        "别的作品改动不该牵连 p-1"
    );
    assert!(status(&state, "p-2").unwrap().stale, "p-2 自己改了内容");

    // 重建 p-1 的索引（等价于 reindex 写入的两个键）：不能顺手把 p-2 判成新鲜。
    crate::services::setting::set(&state, &index_epoch_key("p-1"), "0").unwrap();
    crate::services::setting::set(&state, &indexed_model_key("p-1"), "local-embed:m").unwrap();
    assert!(
        status(&state, "p-2").unwrap().stale,
        "重建 p-1 不得掩盖 p-2 的过期状态"
    );

    // 模型标记同理：各自读自己的那一条，互不覆盖。
    seed_provider(&state, "local-embed", "local", "nomic-embed-text");
    crate::services::setting::set(&state, &indexed_model_key("p-2"), "旧模型:x").unwrap();
    assert_eq!(
        status(&state, "p-1").unwrap().model.as_deref(),
        Some("local-embed:m")
    );
    assert_eq!(
        status(&state, "p-2").unwrap().model.as_deref(),
        Some("旧模型:x")
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// 老库的纪元记在全局键上：升级后作品级键还不存在时必须回退读旧键，
/// 否则本来过期的索引会被当成新鲜；一旦该作品写过作品级键，就以它为准。
#[test]
fn legacy_global_epoch_still_marks_stale() {
    let (state, dir) = temp_state("legacy-epoch");
    seed_project(&state, "p-1");
    ensure_vec_table(&state, 3).unwrap();
    write_chunks(&state, "p-1", &[draft("甲", "A")], &[vec![1.0, 0.0, 0.0]]).unwrap();

    // 模拟升级前的状态：全局内容纪元 2、全局索引纪元 1 → 过期。
    crate::services::setting::set(&state, LEGACY_CONTENT_EPOCH_KEY, "2").unwrap();
    crate::services::setting::set(&state, LEGACY_INDEX_EPOCH_KEY, "1").unwrap();
    assert!(status(&state, "p-1").unwrap().stale);

    // 该作品第一次写入时继承全局纪元再 +1（2 → 3）：内容确实变了，
    // 索引纪元还停在 1 就必须继续判过期，否则老库升级后会拿旧片段回答新问题。
    {
        let conn = state.biz();
        bump_content_epoch(&conn, "p-1").unwrap();
    }
    assert!(
        status(&state, "p-1").unwrap().stale,
        "迁移后内容纪元已越过索引纪元，不能误判新鲜"
    );
    // 作品级索引纪元追上同一数值后，才恢复新鲜；旧全局键不再干扰。
    crate::services::setting::set(&state, &index_epoch_key("p-1"), "3").unwrap();
    assert!(!status(&state, "p-1").unwrap().stale);
    std::fs::remove_dir_all(&dir).ok();
}
