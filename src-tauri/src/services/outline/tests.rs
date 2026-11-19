use super::*;
use crate::infrastructure::db;
use crate::models::{MoveScene, NewForeshadow, NewProject, NewScene, NewStoryElement};
use crate::services::{outline_context, project, story_element};

fn temp_state(tag: &str) -> (DbState, String) {
    let dir = std::env::temp_dir().join(format!("ih-outline-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let state = db::open(&dir).unwrap();
    let created = project::create(
        &state,
        NewProject {
            title: "大纲测试".into(),
            genre: "科幻".into(),
            premise: "一句话梗概".into(),
            audience: "".into(),
            style: "".into(),
            privacy: "any".into(),
        },
    )
    .unwrap();
    (state, created.id)
}

fn add_chapter(state: &DbState, project_id: &str, act: i64, title: &str) -> Chapter {
    create_chapter(
        state,
        NewChapter {
            project_id: project_id.to_string(),
            act,
            title: title.into(),
            summary: "".into(),
            status: "planned".into(),
        },
    )
    .unwrap()
}

fn add_scene(state: &DbState, chapter_id: &str, title: &str) -> Scene {
    create_scene(
        state,
        NewScene {
            chapter_id: chapter_id.to_string(),
            title: title.into(),
            pov: "林墨".into(),
            location: "雨城".into(),
            time_mark: "清晨".into(),
            summary: "".into(),
        },
    )
    .unwrap()
}

#[test]
fn create_chapter_appends_order_within_act() {
    let (state, project_id) = temp_state("order");
    let a = add_chapter(&state, &project_id, 1, "第一章");
    let b = add_chapter(&state, &project_id, 1, "第二章");
    let c = add_chapter(&state, &project_id, 2, "第三章");

    assert_eq!((a.act, a.sort_order), (1, 0));
    assert_eq!((b.act, b.sort_order), (1, 1));
    assert_eq!((c.act, c.sort_order), (2, 0));
    assert!(create_chapter(
        &state,
        NewChapter {
            project_id: project_id.clone(),
            act: 4,
            title: "越界".into(),
            summary: "".into(),
            status: "planned".into(),
        }
    )
    .is_err());
    assert!(create_chapter(
        &state,
        NewChapter {
            project_id: project_id.clone(),
            act: 1,
            title: "   ".into(),
            summary: "".into(),
            status: "planned".into(),
        }
    )
    .is_err());
}

#[test]
fn move_chapter_reorders_and_reassigns_act() {
    let (state, project_id) = temp_state("move-chapter");
    let a = add_chapter(&state, &project_id, 1, "一");
    let b = add_chapter(&state, &project_id, 1, "二");
    let c = add_chapter(&state, &project_id, 2, "三");

    move_chapter(
        &state,
        &MoveChapter {
            project_id: project_id.clone(),
            chapter_id: c.id.clone(),
            target_act: 1,
            target_index: 0,
        },
    )
    .unwrap();

    let chapters = snapshot(&state, &project_id).unwrap().chapters;
    let ids: Vec<&str> = chapters.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, vec![c.id.as_str(), a.id.as_str(), b.id.as_str()]);
    assert_eq!(chapters[0].act, 1);
    assert_eq!((chapters[0].sort_order, chapters[1].sort_order), (0, 1));

    // 再移到第三幕，原幕剩余章节应重新紧凑编号。
    move_chapter(
        &state,
        &MoveChapter {
            project_id: project_id.clone(),
            chapter_id: a.id.clone(),
            target_act: 3,
            target_index: 0,
        },
    )
    .unwrap();
    let chapters = snapshot(&state, &project_id).unwrap().chapters;
    let third: Vec<&Chapter> = chapters.iter().filter(|c| c.act == 3).collect();
    assert_eq!(third.len(), 1);
    assert_eq!(third[0].id, a.id);
    assert_eq!(third[0].sort_order, 0);
}

#[test]
fn move_scene_supports_cross_chapter_and_reindex() {
    let (state, project_id) = temp_state("move-scene");
    let chapter_a = add_chapter(&state, &project_id, 1, "A");
    let chapter_b = add_chapter(&state, &project_id, 1, "B");
    let s1 = add_scene(&state, &chapter_a.id, "场景一");
    let s2 = add_scene(&state, &chapter_a.id, "场景二");
    let s3 = add_scene(&state, &chapter_b.id, "场景三");

    move_scene(
        &state,
        &MoveScene {
            scene_id: s2.id.clone(),
            target_chapter_id: chapter_b.id.clone(),
            target_index: 0,
        },
    )
    .unwrap();
    let scenes = snapshot(&state, &project_id).unwrap().scenes;
    let in_a: Vec<&Scene> = scenes
        .iter()
        .filter(|s| s.chapter_id == chapter_a.id)
        .collect();
    let in_b: Vec<&Scene> = scenes
        .iter()
        .filter(|s| s.chapter_id == chapter_b.id)
        .collect();
    assert_eq!(
        in_a.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec![s1.id.as_str()]
    );
    assert_eq!(
        in_b.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec![s2.id.as_str(), s3.id.as_str()]
    );
    assert_eq!(in_b[0].sort_order, 0);

    // 同章内换位：把场景三移到最前。
    move_scene(
        &state,
        &MoveScene {
            scene_id: s3.id.clone(),
            target_chapter_id: chapter_b.id.clone(),
            target_index: 0,
        },
    )
    .unwrap();
    let scenes = snapshot(&state, &project_id).unwrap().scenes;
    let in_b: Vec<&Scene> = scenes
        .iter()
        .filter(|s| s.chapter_id == chapter_b.id)
        .collect();
    assert_eq!(
        in_b.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec![s3.id.as_str(), s2.id.as_str()]
    );
}

#[test]
fn deleting_chapter_clears_scenes_and_foreshadow_links() {
    let (state, project_id) = temp_state("cascade");
    let chapter = add_chapter(&state, &project_id, 1, "唯一章");
    add_scene(&state, &chapter.id, "场景");
    create_foreshadow(
        &state,
        NewForeshadow {
            project_id: project_id.clone(),
            title: "断剑".into(),
            setup_chapter_id: Some(chapter.id.clone()),
            payoff_chapter_id: Some(chapter.id.clone()),
            status: "setup".into(),
        },
    )
    .unwrap();

    delete_chapter(&state, &chapter.id).unwrap();
    let snapshot = snapshot(&state, &project_id).unwrap();
    assert!(snapshot.chapters.is_empty());
    assert!(snapshot.scenes.is_empty());
    assert_eq!(snapshot.foreshadows.len(), 1);
    assert!(snapshot.foreshadows[0].setup_chapter_id.is_none());
    assert!(snapshot.foreshadows[0].payoff_chapter_id.is_none());
}

#[test]
fn foreshadow_rejects_chapter_from_other_project() {
    let (state, project_id) = temp_state("foreshadow-owner");
    let other = project::create(
        &state,
        NewProject {
            title: "另一部".into(),
            genre: "".into(),
            premise: "".into(),
            audience: "".into(),
            style: "".into(),
            privacy: "any".into(),
        },
    )
    .unwrap();
    let foreign = add_chapter(&state, &other.id, 1, "别人的章节");

    let error = create_foreshadow(
        &state,
        NewForeshadow {
            project_id: project_id.clone(),
            title: "跨作品伏笔".into(),
            setup_chapter_id: Some(foreign.id),
            payoff_chapter_id: None,
            status: "planned".into(),
        },
    )
    .unwrap_err();
    assert!(error.message.contains("不属于当前作品"));
}

#[test]
fn project_context_includes_bible_outline_and_foreshadow() {
    let (state, project_id) = temp_state("context");
    let hero = story_element::create(
        &state,
        NewStoryElement {
            project_id: project_id.clone(),
            kind: "character".into(),
            name: "林墨".into(),
            summary: "主角".into(),
            detail: serde_json::json!({ "aliases": ["墨"] }),
        },
    )
    .unwrap();
    story_element::create(
        &state,
        NewStoryElement {
            project_id: project_id.clone(),
            kind: "place".into(),
            name: "雨城".into(),
            summary: "故事发生地".into(),
            detail: serde_json::json!({
                "relations": [{ "targetId": hero.id, "type": "knows" }]
            }),
        },
    )
    .unwrap();

    let chapter = create_chapter(
        &state,
        NewChapter {
            project_id: project_id.clone(),
            act: 1,
            title: "雨夜".into(),
            summary: "主角登场".into(),
            status: "drafting".into(),
        },
    )
    .unwrap();
    add_scene(&state, &chapter.id, "破庙相遇");
    create_foreshadow(
        &state,
        NewForeshadow {
            project_id: project_id.clone(),
            title: "断剑".into(),
            setup_chapter_id: Some(chapter.id.clone()),
            payoff_chapter_id: None,
            status: "setup".into(),
        },
    )
    .unwrap();

    let context = outline_context::build_context(&state, &project_id).unwrap();
    assert!(context.contains("# 作品上下文：《大纲测试》"));
    assert!(context.contains("### 人物"));
    assert!(context.contains("**林墨（别名：墨）**：主角"));
    assert!(context.contains("关联：林墨（knows）"));
    assert!(context.contains("### 第一幕"));
    assert!(context.contains("第 1 章 · 雨夜（写作中）"));
    assert!(context.contains("场景 1 · 破庙相遇"));
    assert!(context.contains("- [已铺设] 断剑：铺设「雨夜」→ 回收「未指定」"));
}

#[test]
fn project_context_includes_character_notes() {
    let (state, project_id) = temp_state("context-notes");
    story_element::create(
        &state,
        NewStoryElement {
            project_id: project_id.clone(),
            kind: "character".into(),
            name: "张三".into(),
            summary: "".into(),
            detail: serde_json::json!({ "notes": "冷静的工程学家，沉默寡言" }),
        },
    )
    .unwrap();

    let context = outline_context::build_context(&state, &project_id).unwrap();
    assert!(
        context.contains("补充备注：冷静的工程学家，沉默寡言"),
        "补充备注必须进入 AI 上下文，否则模型只能看到角色名"
    );
}
