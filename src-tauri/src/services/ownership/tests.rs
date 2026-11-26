use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::infrastructure::db;
use crate::models::{NewForeshadow, NewProject, NewScene};
use crate::services::{outline, project};

/// 两个作品各建一份临时库，避免并行测试抢同一个目录。
fn two_projects(tag: &str) -> (DbState, String, String) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ih-own-{tag}-{}-{nonce}", std::process::id()));
    let state = db::open(&dir).unwrap();
    let make = |title: &str| {
        project::create(
            &state,
            NewProject {
                title: title.into(),
                genre: "科幻".into(),
                premise: "一句话梗概".into(),
                audience: "".into(),
                style: "".into(),
                privacy: "any".into(),
            },
        )
        .unwrap()
        .id
    };
    let first = make("甲");
    let second = make("乙");
    (state, first, second)
}

fn chapter_in(state: &DbState, project_id: &str) -> String {
    outline::create_chapter(
        state,
        crate::models::NewChapter {
            project_id: project_id.into(),
            act: 1,
            title: "第一章".into(),
            summary: "".into(),
            status: "planned".into(),
        },
    )
    .unwrap()
    .id
}

#[test]
fn assert_project_rejects_unknown_id() {
    let (state, project_id, _) = two_projects("project");
    assert!(assert_project(&state, &project_id).is_ok());
    assert_eq!(assert_project(&state, "missing").unwrap_err().code(), "not_found");
}

#[test]
fn chapter_scene_and_foreshadow_reject_foreign_project() {
    let (state, owner, other) = two_projects("resources");
    let chapter_id = chapter_in(&state, &owner);
    assert!(assert_chapter(&state, &chapter_id, &owner).is_ok());
    assert_eq!(
        assert_chapter(&state, &chapter_id, &other).unwrap_err().code(),
        "not_found"
    );

    let scene_id = outline::create_scene(
        &state,
        NewScene {
            chapter_id: chapter_id.clone(),
            title: "一场戏".into(),
            pov: "".into(),
            location: "".into(),
            time_mark: "".into(),
            summary: "".into(),
        },
    )
    .unwrap()
    .id;
    assert!(assert_scene(&state, &scene_id, &owner).is_ok());
    assert_eq!(
        assert_scene(&state, &scene_id, &other).unwrap_err().code(),
        "not_found"
    );

    let foreshadow_id = outline::create_foreshadow(
        &state,
        NewForeshadow {
            project_id: owner.clone(),
            title: "一条伏笔".into(),
            setup_chapter_id: None,
            payoff_chapter_id: None,
            status: "planned".into(),
        },
    )
    .unwrap()
    .id;
    assert!(assert_foreshadow(&state, &foreshadow_id, &owner).is_ok());
    assert_eq!(
        assert_foreshadow(&state, &foreshadow_id, &other)
            .unwrap_err()
            .code(),
        "not_found"
    );
}

#[test]
fn missing_resources_are_reported_as_not_found() {
    let (state, owner, _) = two_projects("missing");
    for err in [
        assert_chapter(&state, "missing", &owner).unwrap_err(),
        assert_scene(&state, "missing", &owner).unwrap_err(),
        assert_foreshadow(&state, "missing", &owner).unwrap_err(),
        assert_version(&state, "missing", &owner).unwrap_err(),
    ] {
        assert_eq!(err.code(), "not_found");
    }
}
