use super::*;
use crate::error::ErrorCode;
use crate::infrastructure::db;
use crate::models::{ApplyWorkflowInput, NewChapter, NewProject, SaveContentInput};
use crate::services::{draft, outline, project};

/// 建一个临时库 + 一部作品 + 一章，返回 (state, project_id, chapter_id)。
fn temp_chapter(tag: &str) -> (DbState, String, String) {
    let dir = std::env::temp_dir().join(format!("ih-workflow-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let state = db::open(&dir).unwrap();
    let created = project::create(
        &state,
        NewProject {
            title: "工作流测试".into(),
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
            project_id: created.id.clone(),
            act: 1,
            title: "第一章".into(),
            summary: "".into(),
            status: "planned".into(),
        },
    )
    .unwrap();
    (state, created.id, chapter.id)
}

/// 构造一份最小可执行的工作流状态：只有目标阶段被设置成指定状态。
fn workflow_json(chapter_id: &str, stage: &str, status: &str) -> String {
    let mut stages = serde_json::Map::new();
    for key in ["ideation", "writing", "editing", "review", "publish"] {
        stages.insert(
            key.to_string(),
            serde_json::json!({
                "status": if key == stage { status } else { "idle" },
                "artifact": "",
                "error": "",
                "model": "",
                "decision": "",
                "decidedAt": "",
                "note": "",
            }),
        );
    }
    serde_json::json!({
        "version": STATE_VERSION,
        "selectedChapterId": chapter_id,
        "stages": stages,
        "updatedAt": "",
    })
    .to_string()
}

fn input(project_id: &str, chapter_id: &str, decision: &str, status: &str, revision: i64) -> ApplyWorkflowInput {
    ApplyWorkflowInput {
        project_id: project_id.into(),
        stage: "writing".into(),
        decision: decision.into(),
        workflow_json: workflow_json(chapter_id, "writing", status),
        content_write: Some(SaveContentInput {
            chapter_id: chapter_id.into(),
            content: "{\"type\":\"doc\",\"content\":[]}".into(),
            word_count: 120,
            snapshot: true,
            expected_content_revision: Some(revision),
        }),
    }
}

/// 正常审批：正文、快照、RAG 纪元与阶段状态一次性落库。
#[test]
fn approval_writes_content_snapshot_and_stage_together() {
    let (state, project_id, chapter_id) = temp_chapter("ok");
    let key = state_key(&project_id);
    setting::set(&state, &key, &workflow_json(&chapter_id, "writing", "pending")).unwrap();

    apply_workflow(&state, input(&project_id, &chapter_id, "approved", "approved", 0)).unwrap();

    let content = draft::get_content(&state, &chapter_id).unwrap();
    assert_eq!(content.word_count, 120);
    assert_eq!(content.content_revision, 1);
    assert_eq!(draft::list_versions(&state, &chapter_id).unwrap().len(), 1);
    assert!(setting::get(&state, &key).unwrap().unwrap().contains("\"status\":\"approved\""));
}

/// 正文版本陈旧：整笔回滚，阶段仍停在 pending，正文也没被覆盖。
#[test]
fn stale_content_revision_rolls_back_stage() {
    let (state, project_id, chapter_id) = temp_chapter("stale");
    let key = state_key(&project_id);
    let pending = workflow_json(&chapter_id, "writing", "pending");
    setting::set(&state, &key, &pending).unwrap();

    let err = apply_workflow(&state, input(&project_id, &chapter_id, "approved", "approved", 42))
        .expect_err("陈旧版本必须被拒绝");
    assert_eq!(err.code, ErrorCode::Conflict);

    assert_eq!(draft::get_content(&state, &chapter_id).unwrap().content_revision, 0);
    assert_eq!(setting::get(&state, &key).unwrap().unwrap(), pending);
}

/// 阶段已不是 pending：拒绝重复审批，正文不受影响。
#[test]
fn non_pending_stage_rejects_write() {
    let (state, project_id, chapter_id) = temp_chapter("guard");
    let key = state_key(&project_id);
    setting::set(&state, &key, &workflow_json(&chapter_id, "writing", "approved")).unwrap();

    let err = apply_workflow(&state, input(&project_id, &chapter_id, "approved", "approved", 0))
        .expect_err("已通过的阶段不能再审批一次");
    assert_eq!(err.code, ErrorCode::Conflict);

    assert_eq!(draft::get_content(&state, &chapter_id).unwrap().content_revision, 0);
}

/// 正文写入失败（章节不存在）：阶段状态不能先写出去。
#[test]
fn failed_content_write_keeps_stage_pending() {
    let (state, project_id, chapter_id) = temp_chapter("missing");
    let key = state_key(&project_id);
    let pending = workflow_json(&chapter_id, "writing", "pending");
    setting::set(&state, &key, &pending).unwrap();

    let mut payload = input(&project_id, &chapter_id, "approved", "approved", 0);
    payload.content_write.as_mut().unwrap().chapter_id = "not-exist".into();
    let err = apply_workflow(&state, payload).expect_err("章节不存在必须失败");
    assert_ne!(err.code, ErrorCode::Conflict);

    assert_eq!(setting::get(&state, &key).unwrap().unwrap(), pending);
}
