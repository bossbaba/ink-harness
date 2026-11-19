//! 设定库服务的单测：CRUD、级联删除、全局汇总与一致性检查。
//! 单独成文件，避免 story_element.rs 超过项目规定的 500 行上限。

use super::*;
use crate::infrastructure::db;
use crate::models::NewProject;
use crate::services::project;

fn temp_state(tag: &str) -> (DbState, String) {
    let dir = std::env::temp_dir().join(format!("ih-bible-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let state = db::open(&dir).unwrap();
    let created = project::create(
        &state,
        NewProject {
            title: "测试作品".into(),
            genre: "".into(),
            premise: "".into(),
            audience: "".into(),
            style: "".into(),
            privacy: "any".into(),
        },
    )
    .unwrap();
    (state, created.id)
}

#[test]
fn parse_year_supports_common_formats() {
    assert_eq!(parse_year("2024-03-15"), Some(2024));
    assert_eq!(parse_year("公元前221年"), Some(-221));
    assert_eq!(parse_year("19世纪"), Some(1800));
    assert_eq!(parse_year("不明确"), None);
}

#[test]
fn crud_and_relation_validation() {
    let (state, project_id) = temp_state("crud");
    let a = create(
        &state,
        NewStoryElement {
            project_id: project_id.clone(),
            kind: "character".into(),
            name: " 林墨 ".into(),
            summary: "主角".into(),
            detail: json!({ "aliases": ["墨"] }),
        },
    )
    .unwrap();
    assert_eq!(a.name, "林墨");

    let b = create(
        &state,
        NewStoryElement {
            project_id: project_id.clone(),
            kind: "place".into(),
            name: "雨城".into(),
            summary: "".into(),
            detail: json!({
                "relations": [{ "targetId": a.id, "type": "located-in" }]
            }),
        },
    )
    .unwrap();
    assert_eq!(list(&state, &project_id).unwrap().len(), 2);

    let mut updated = b.clone();
    updated.detail = json!({ "relations": [{ "targetId": "missing", "type": "x" }] });
    assert!(update(&state, &updated).is_err());

    remove(&state, &b.id).unwrap();
    assert!(get(&state, &b.id).unwrap().is_none());
    assert_eq!(list(&state, &project_id).unwrap().len(), 1);
}

#[test]
fn deleting_project_cascades_story_elements() {
    let (state, project_id) = temp_state("cascade");
    let element = create(
        &state,
        NewStoryElement {
            project_id: project_id.clone(),
            kind: "term".into(),
            name: "术语".into(),
            summary: "".into(),
            detail: json!({}),
        },
    )
    .unwrap();
    project::remove(&state, &project_id).unwrap();
    assert!(get(&state, &element.id).unwrap().is_none());
}

#[test]
fn list_all_aggregates_across_projects() {
    let (state, project_id) = temp_state("all");
    let other = project::create(
        &state,
        NewProject {
            title: "另一部作品".into(),
            genre: "".into(),
            premise: "".into(),
            audience: "".into(),
            style: "".into(),
            privacy: "any".into(),
        },
    )
    .unwrap();
    for (pid, name) in [(project_id, "甲"), (other.id, "乙")] {
        create(
            &state,
            NewStoryElement {
                project_id: pid,
                kind: "character".into(),
                name: name.into(),
                summary: "".into(),
                detail: json!({}),
            },
        )
        .unwrap();
    }
    let all = list_all(&state).unwrap();
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|item| item.project_title == "测试作品"));
    assert!(all.iter().any(|item| item.project_title == "另一部作品"));
}

#[test]
fn consistency_reports_duplicates_and_timeline_conflicts() {
    let (state, project_id) = temp_state("consistency");
    for name in [" 林墨", "林 墨 "] {
        create(
            &state,
            NewStoryElement {
                project_id: project_id.clone(),
                kind: "character".into(),
                name: name.into(),
                summary: "".into(),
                detail: json!({}),
            },
        )
        .unwrap();
    }
    for (name, start, end) in [
        ("第一时期", "2020-01", "2024-12"),
        ("第二时期", "2023", "2026"),
        ("倒置时期", "2030", "2028"),
    ] {
        create(
            &state,
            NewStoryElement {
                project_id: project_id.clone(),
                kind: "event".into(),
                name: name.into(),
                summary: "".into(),
                detail: json!({ "timeStart": start, "timeEnd": end }),
            },
        )
        .unwrap();
    }

    let issues = check_consistency(&state, &project_id).unwrap();
    assert!(issues.iter().any(|i| i.kind == "duplicate-name"));
    assert!(issues.iter().any(|i| i.kind == "timeline-conflict"));
    assert!(issues.iter().any(|i| i.kind == "invalid-time-range"));
}

/// 删设定同样要连带清掉 RAG 片段（kind = element），且与删除同事务。
#[test]
fn remove_element_removes_rag_chunk() {
    let (state, project_id) = temp_state("rag-chunk");
    {
        let conn = state.biz();
        conn.execute(
            "insert into story_element
             (id, project_id, kind, name, summary, detail_json, created_at, updated_at)
             values ('el-rag', ?1, 'character', '墨白', '少年剑客', '{}', 'x', 'x')",
            params![project_id],
        )
        .unwrap();
        conn.execute(
            "insert into rag_chunk (project_id, kind, source_id, title, content, indexed_at)
             values (?1, 'element', 'el-rag', '墨白', '少年剑客', 'x')",
            params![project_id],
        )
        .unwrap();
    }

    remove(&state, "el-rag").unwrap();

    let (elements, chunks): (i64, i64) = {
        let conn = state.biz();
        (
            conn.query_row(
                "select count(*) from story_element where id = 'el-rag'",
                [],
                |row| row.get(0),
            )
            .unwrap(),
            conn.query_row(
                "select count(*) from rag_chunk where source_id = 'el-rag'",
                [],
                |row| row.get(0),
            )
            .unwrap(),
        )
    };
    assert_eq!(elements, 0);
    assert_eq!(chunks, 0, "删设定后片段必须随同一事务消失");
}
