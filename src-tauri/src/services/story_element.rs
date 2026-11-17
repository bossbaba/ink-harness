//! 设定库领域服务：条目 CRUD 与基础一致性检查。不依赖 Tauri。

use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Map, Value};

use crate::infrastructure::db::DbState;
use crate::models::{ConsistencyIssue, NewStoryElement, StoryElement, StoryElementOverview};

pub const ELEMENT_KINDS: [&str; 5] = ["character", "place", "org", "term", "event"];

fn gen_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("se-{ts:x}-{n:x}")
}

const SELECT_COLUMNS: &str =
    "id, project_id, kind, name, summary, detail_json, created_at, updated_at";

fn row_to_element(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoryElement> {
    let detail: String = row.get(5)?;
    Ok(StoryElement {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        summary: row.get(4)?,
        detail: serde_json::from_str(&detail).unwrap_or_else(|_| json!({})),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn detail_object(value: &Value) -> Result<&Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| "扩展字段必须是 JSON 对象".to_string())
}

fn relation_targets(detail: &Value) -> Vec<String> {
    detail
        .get("relations")
        .and_then(Value::as_array)
        .map(|relations| {
            relations
                .iter()
                .filter_map(|r| {
                    r.get("targetId")
                        .or_else(|| r.get("target_id"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn detail_string(detail: &Value, key: &str) -> Option<String> {
    detail
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn project_exists(conn: &rusqlite::Connection, project_id: &str) -> Result<bool, String> {
    conn.query_row(
        "select 1 from project where id = ?1",
        params![project_id],
        |_| Ok(()),
    )
    .optional()
    .map(|v| v.is_some())
    .map_err(|e| e.to_string())
}

fn validate(
    conn: &rusqlite::Connection,
    project_id: &str,
    kind: &str,
    name: &str,
    detail: &Value,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("设定名称不能为空".into());
    }
    if !ELEMENT_KINDS.contains(&kind) {
        return Err(format!("不支持的设定类型：{kind}"));
    }
    if !project_exists(conn, project_id)? {
        return Err("作品不存在".into());
    }
    detail_object(detail)?;
    for target in relation_targets(detail) {
        let exists: bool = conn
            .query_row(
                "select 1 from story_element where id = ?1 and project_id = ?2",
                params![target, project_id],
                |_| Ok(true),
            )
            .optional()
            .map(|v| v.is_some())
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("关联目标不存在：{target}"));
        }
    }
    Ok(())
}

pub fn list(state: &DbState, project_id: &str) -> Result<Vec<StoryElement>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "select {SELECT_COLUMNS} from story_element where project_id = ?1 \
             order by case kind \
               when 'character' then 0 when 'place' then 1 when 'org' then 2 \
               when 'event' then 3 when 'term' then 4 else 5 end, name collate nocase"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], row_to_element)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 全局设定库：跨作品汇总，仅供浏览，不在此修改。
pub fn list_all(state: &DbState) -> Result<Vec<StoryElementOverview>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "select se.{}, p.title \
                 from story_element se join project p on se.project_id = p.id \
                 order by p.title, case se.kind \
                   when 'character' then 0 when 'place' then 1 when 'org' then 2 \
                   when 'event' then 3 when 'term' then 4 else 5 end, se.name collate nocase",
            SELECT_COLUMNS.replace(", ", ", se.")
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StoryElementOverview {
                element: row_to_element(row)?,
                project_title: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get(state: &DbState, id: &str) -> Result<Option<StoryElement>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("select {SELECT_COLUMNS} from story_element where id = ?1"),
        params![id],
        row_to_element,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn create(state: &DbState, input: NewStoryElement) -> Result<StoryElement, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    validate(
        &conn,
        &input.project_id,
        &input.kind,
        &input.name,
        &input.detail,
    )?;
    let id = gen_id();
    let detail = serde_json::to_string(&input.detail).map_err(|e| e.to_string())?;
    conn.execute(
        r#"insert into story_element
           (id, project_id, kind, name, summary, detail_json, created_at, updated_at)
           values (?1, ?2, ?3, ?4, ?5, ?6,
                   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"#,
        params![
            id,
            input.project_id,
            input.kind,
            input.name.trim(),
            input.summary,
            detail
        ],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    get(state, &id)?.ok_or_else(|| "创建后读取失败".into())
}

pub fn update(state: &DbState, element: &StoryElement) -> Result<(), String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    validate(
        &conn,
        &element.project_id,
        &element.kind,
        &element.name,
        &element.detail,
    )?;
    let detail = serde_json::to_string(&element.detail).map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            r#"update story_element set kind=?2, name=?3, summary=?4, detail_json=?5,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?1"#,
            params![
                element.id,
                element.kind,
                element.name.trim(),
                element.summary,
                detail
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("设定条目不存在".into());
    }
    Ok(())
}

pub fn remove(state: &DbState, id: &str) -> Result<(), String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    conn.execute("delete from story_element where id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从自由文本中提取年份，支持「2024-03」「公元前221年」「19世纪」等写法。
fn parse_year(raw: &str) -> Option<i32> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let bc = s.contains("公元前") || s.to_ascii_uppercase().contains("BC");
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).take(4).collect();
    if digits.is_empty() {
        return None;
    }
    let mut year: i32 = digits.parse().ok()?;
    if s.contains("世纪") {
        year = (year - 1) * 100;
    }
    if bc {
        year = -year;
    }
    Some(year)
}

fn normalize_name(name: &str) -> String {
    name.split_whitespace().collect::<String>().to_lowercase()
}

/// 基础一致性检查：重名/术语重复、时间线区间冲突、无效时间范围、失效关联。
pub fn check_consistency(
    state: &DbState,
    project_id: &str,
) -> Result<Vec<ConsistencyIssue>, String> {
    let elements = list(state, project_id)?;
    let mut issues = Vec::new();

    let mut by_name: BTreeMap<String, Vec<&StoryElement>> = BTreeMap::new();
    for element in &elements {
        by_name
            .entry(normalize_name(&element.name))
            .or_default()
            .push(element);
    }
    for (name, group) in by_name {
        if group.len() > 1 {
            issues.push(ConsistencyIssue {
                id: format!("dup-{name}"),
                kind: "duplicate-name".into(),
                severity: "warning".into(),
                title: format!("名称重复：{}", group[0].name),
                detail: format!(
                    "{} 个设定条目使用相同名称，可能导致上下文混淆。",
                    group.len()
                ),
                element_ids: group.iter().map(|e| e.id.clone()).collect(),
            });
        }
    }

    let ids: HashSet<&str> = elements.iter().map(|e| e.id.as_str()).collect();
    let mut intervals: Vec<(&StoryElement, i32, i32)> = Vec::new();
    for element in &elements {
        for target in relation_targets(&element.detail) {
            if !ids.contains(target.as_str()) {
                issues.push(ConsistencyIssue {
                    id: format!("rel-{}-{}", element.id, target),
                    kind: "broken-relation".into(),
                    severity: "warning".into(),
                    title: format!("{} 的关联目标不存在", element.name),
                    detail: format!("关联 ID：{target}"),
                    element_ids: vec![element.id.clone()],
                });
            }
        }
        if element.kind != "event" {
            continue;
        }
        let start = detail_string(&element.detail, "timeStart").and_then(|v| parse_year(&v));
        let end = detail_string(&element.detail, "timeEnd").and_then(|v| parse_year(&v));
        match (start, end) {
            (Some(s), Some(e)) if s > e => issues.push(ConsistencyIssue {
                id: format!("range-{}", element.id),
                kind: "invalid-time-range".into(),
                severity: "warning".into(),
                title: format!("{} 的时间范围倒置", element.name),
                detail: format!("起始年份 {s} 晚于结束年份 {e}。"),
                element_ids: vec![element.id.clone()],
            }),
            (Some(s), Some(e)) => intervals.push((element, s, e)),
            _ => {}
        }
    }
    for (i, (a, a_start, a_end)) in intervals.iter().enumerate() {
        for (b, b_start, b_end) in intervals.iter().skip(i + 1) {
            if a_start <= b_end && b_start <= a_end {
                issues.push(ConsistencyIssue {
                    id: format!("time-{}-{}", a.id, b.id),
                    kind: "timeline-conflict".into(),
                    severity: "info".into(),
                    title: format!("时间线重叠：{} / {}", a.name, b.name),
                    detail: format!("{a_start}–{a_end} 与 {b_start}–{b_end} 存在重叠。"),
                    element_ids: vec![a.id.clone(), b.id.clone()],
                });
            }
        }
    }

    Ok(issues)
}

#[cfg(test)]
mod tests {
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
}
