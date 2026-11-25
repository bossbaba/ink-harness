use super::*;
use crate::infrastructure::db;
use crate::models::{NewChapter, NewProject};
use crate::services::{outline, project};

/// 建一个临时库 + 一部作品 + 一章，返回 (state, 章节 id)。
fn temp_chapter(tag: &str) -> (DbState, String) {
    let dir = std::env::temp_dir().join(format!("ih-draft-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let state = db::open(&dir).unwrap();
    let created = project::create(
        &state,
        NewProject {
            title: "写作测试".into(),
            genre: "".into(),
            premise: "".into(),
            audience: "".into(),
            style: "".into(),
            privacy: "any".into(),
        },
    )
    .unwrap();
    let chapter = outline::create_chapter(
        &state,
        NewChapter {
            project_id: created.id,
            act: 1,
            title: "第一章".into(),
            summary: "".into(),
            status: "planned".into(),
        },
    )
    .unwrap();
    (state, chapter.id)
}

fn save(
    state: &DbState,
    chapter_id: &str,
    content: &str,
    words: i64,
    snapshot: bool,
) -> ChapterContent {
    save_content(
        state,
        SaveContentInput {
            chapter_id: chapter_id.into(),
            content: content.into(),
            word_count: words,
            snapshot,
            expected_content_revision: None,
        },
    )
    .unwrap()
}

/// 首次落笔：正文入库、字数回写、章节状态从「待写」推进到「写作中」，并自动留一版底稿。
#[test]
fn save_content_promotes_chapter_and_snapshots_first_draft() {
    let (state, chapter_id) = temp_chapter("first");
    let saved = save(&state, &chapter_id, "{\"type\":\"doc\"}", 120, false);

    assert_eq!(saved.word_count, 120);
    let chapter = outline::get_chapter(&state, &chapter_id).unwrap().unwrap();
    assert_eq!(chapter.status, "drafting");
    assert_eq!(chapter.word_count, 120);

    let versions = list_versions(&state, &chapter_id).unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].word_count, 120);
}

/// 自动保存：字数只涨了几十个字不新增版本，跨过阈值才留一版。
#[test]
fn auto_save_only_snapshots_after_big_change() {
    let (state, chapter_id) = temp_chapter("auto");
    save(&state, &chapter_id, "v1", 100, false);
    save(&state, &chapter_id, "v2", 160, false);
    assert_eq!(list_versions(&state, &chapter_id).unwrap().len(), 1);

    save(&state, &chapter_id, "v3", 900, false);
    assert_eq!(list_versions(&state, &chapter_id).unwrap().len(), 2);
}

/// 手动保存快照：内容有变化才留版，重复点击不会写出重复版本。
#[test]
fn manual_snapshot_skips_duplicate_content() {
    let (state, chapter_id) = temp_chapter("manual");
    save(&state, &chapter_id, "a", 10, true);
    assert_eq!(list_versions(&state, &chapter_id).unwrap().len(), 1);

    save(&state, &chapter_id, "a", 10, true);
    assert_eq!(list_versions(&state, &chapter_id).unwrap().len(), 1);

    save(&state, &chapter_id, "b", 12, true);
    assert_eq!(list_versions(&state, &chapter_id).unwrap().len(), 2);
}

/// 恢复历史版本：正文回到旧内容；当前正文已有对应快照时不再重复补一份。
#[test]
fn restore_version_rolls_back_content() {
    let (state, chapter_id) = temp_chapter("restore");
    save(&state, &chapter_id, "旧正文", 30, true);
    save(&state, &chapter_id, "新正文", 60, true);

    let versions = list_versions(&state, &chapter_id).unwrap();
    let oldest = versions.last().unwrap();
    let restored = restore_version(&state, &oldest.id, None).unwrap();

    assert_eq!(restored.content, "旧正文");
    assert_eq!(restored.word_count, 30);
    // 「新正文」在第 2 版里已经存过，恢复时不再补重复底稿。
    let after = list_versions(&state, &chapter_id).unwrap();
    assert_eq!(after.len(), 2);
}

/// 陈旧基准必须报冲突，不能让恢复操作覆盖另一处刚保存的新稿。
#[test]
fn restore_version_rejects_stale_revision() {
    let (state, chapter_id) = temp_chapter("restore-stale");
    save(&state, &chapter_id, "旧正文", 30, true);
    let version_id = list_versions(&state, &chapter_id).unwrap()[0].id.clone();
    let stale = get_content(&state, &chapter_id).unwrap().content_revision + 1;

    let error = restore_version(&state, &version_id, Some(stale)).unwrap_err();
    assert!(error.to_string().contains("冲突") || error.to_string().contains("重新载入"));
    assert_eq!(get_content(&state, &chapter_id).unwrap().content, "旧正文");
}

/// 恢复时若当前正文从未存过快照（例如只靠自动保存写进去的），先补一版再覆盖。
#[test]
fn restore_version_backs_up_unsaved_snapshot() {
    let (state, chapter_id) = temp_chapter("restore-backup");
    save(&state, &chapter_id, "底稿", 20, true);
    // 第二次保存字数差不足阈值，不会生成版本，正文只存在于 chapter 表里。
    save(&state, &chapter_id, "自动保存的正文", 100, false);

    let version_id = list_versions(&state, &chapter_id).unwrap()[0].id.clone();
    let restored = restore_version(&state, &version_id, None).unwrap();
    assert_eq!(restored.content, "底稿");

    let after = list_versions(&state, &chapter_id).unwrap();
    assert_eq!(after.len(), 2);
    assert_eq!(after[0].word_count, 100);
}

/// 版本数量超过上限时只保留最新的若干版，防止历史无限膨胀。
#[test]
fn versions_are_pruned_to_limit() {
    let (state, chapter_id) = temp_chapter("prune");
    for index in 0..(MAX_VERSIONS_PER_CHAPTER + 3) {
        save(&state, &chapter_id, &format!("v{index}"), index, true);
    }
    let versions = list_versions(&state, &chapter_id).unwrap();
    assert_eq!(versions.len() as i64, MAX_VERSIONS_PER_CHAPTER);
    // 最新一版必须是最后写入的那次。
    assert_eq!(versions[0].word_count, MAX_VERSIONS_PER_CHAPTER + 2);
}

/// 正文乐观锁：拿着旧版本号保存必须被拒绝，且库里内容不能被覆盖。
#[test]
fn stale_content_revision_is_rejected() {
    let (state, chapter_id) = temp_chapter("conflict");
    let first = save(&state, &chapter_id, "第一版正文", 5, false);
    assert_eq!(first.content_revision, 1);

    // 模拟「另一个页面」用旧版本号写：应当冲突，且内容保持第一次写的那版。
    let stale = save_content(
        &state,
        SaveContentInput {
            chapter_id: chapter_id.clone(),
            content: "旧副本写回".into(),
            word_count: 5,
            snapshot: false,
            expected_content_revision: Some(first.content_revision - 1),
        },
    );
    assert!(stale.is_err());
    assert_eq!(
        get_content(&state, &chapter_id).unwrap().content,
        "第一版正文"
    );

    // 用最新版本号继续写是允许的，版本号随之前进。
    let next = save_content(
        &state,
        SaveContentInput {
            chapter_id: chapter_id.clone(),
            content: "第二版正文".into(),
            word_count: 5,
            snapshot: false,
            expected_content_revision: Some(first.content_revision),
        },
    )
    .unwrap();
    assert_eq!(next.content_revision, 2);
    assert_eq!(next.content, "第二版正文");
}

/// 章节不存在时不能静默返回空正文——写作台必须能区分「没写过」和「章节没了」。
#[test]
fn missing_chapter_reports_error_and_negative_words_rejected() {
    let (state, chapter_id) = temp_chapter("error");
    assert!(get_content(&state, "ch-not-exist").is_err());

    let result = save_content(
        &state,
        SaveContentInput {
            chapter_id,
            content: "x".into(),
            word_count: -1,
            snapshot: false,
            expected_content_revision: None,
        },
    );
    assert!(result.is_err());
}
