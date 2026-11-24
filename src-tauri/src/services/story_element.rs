//! 设定库领域服务：条目 CRUD 与基础一致性检查。不依赖 Tauri。

use std::collections::{BTreeMap, HashSet};

use rusqlite::{OptionalExtension, params};
use serde_json::{Map, Value, json};

use crate::error::AppError;
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

fn detail_object(value: &Value) -> Result<&Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| AppError::validation("扩展字段必须是 JSON 对象"))
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

fn project_exists(conn: &rusqlite::Connection, project_id: &str) -> Result<bool, AppError> {
    conn.query_row(
        "select 1 from project where id = ?1",
        params![project_id],
        |_| Ok(()),
    )
    .optional()
    .map(|v| v.is_some())
    .map_err(AppError::from)
}

fn validate(
    conn: &rusqlite::Connection,
    project_id: &str,
    kind: &str,
    name: &str,
    detail: &Value,
) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::validation("设定名称不能为空"));
    }
    if !ELEMENT_KINDS.contains(&kind) {
        return Err(AppError::validation(format!("不支持的设定类型：{kind}")));
    }
    if !project_exists(conn, project_id)? {
        return Err(AppError::not_found("作品不存在"));
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
            .map_err(AppError::from)?;
        if !exists {
            return Err(AppError::not_found(format!("关联目标不存在：{target}")));
        }
    }
    Ok(())
}

pub fn list(state: &DbState, project_id: &str) -> Result<Vec<StoryElement>, AppError> {
    let conn = state.biz();
    let mut stmt = conn
        .prepare(&format!(
            "select {SELECT_COLUMNS} from story_element where project_id = ?1 \
             order by case kind \
               when 'character' then 0 when 'place' then 1 when 'org' then 2 \
               when 'event' then 3 when 'term' then 4 else 5 end, name collate nocase"
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], row_to_element)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 全局设定库：跨作品汇总，仅供浏览，不在此修改。
pub fn list_all(state: &DbState) -> Result<Vec<StoryElementOverview>, AppError> {
    let conn = state.biz();
    let mut stmt = conn
        .prepare(&format!(
            "select se.{}, p.title \
                 from story_element se join project p on se.project_id = p.id \
                 order by p.title, case se.kind \
                   when 'character' then 0 when 'place' then 1 when 'org' then 2 \
                   when 'event' then 3 when 'term' then 4 else 5 end, se.name collate nocase",
            SELECT_COLUMNS.replace(", ", ", se.")
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StoryElementOverview {
                element: row_to_element(row)?,
                project_title: row.get(8)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn get(state: &DbState, id: &str) -> Result<Option<StoryElement>, AppError> {
    let conn = state.biz();
    conn.query_row(
        &format!("select {SELECT_COLUMNS} from story_element where id = ?1"),
        params![id],
        row_to_element,
    )
    .optional()
    .map_err(AppError::from)
}

pub fn create(state: &DbState, input: NewStoryElement) -> Result<StoryElement, AppError> {
    let conn = state.biz();
    validate(
        &conn,
        &input.project_id,
        &input.kind,
        &input.name,
        &input.detail,
    )?;
    let id = gen_id();
    let detail = serde_json::to_string(&input.detail).map_err(AppError::from)?;
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    tx.execute(
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
    .map_err(AppError::from)?;
    // 新设定进入检索范围，该作品的索引过期。
    crate::services::rag::bump_content_epoch(&tx, &input.project_id)?;
    tx.commit().map_err(AppError::from)?;
    drop(conn);
    get(state, &id)?.ok_or_else(|| AppError::internal("创建后读取失败"))
}

pub fn update(state: &DbState, element: &StoryElement) -> Result<(), AppError> {
    let conn = state.biz();
    validate(
        &conn,
        &element.project_id,
        &element.kind,
        &element.name,
        &element.detail,
    )?;
    let detail = serde_json::to_string(&element.detail).map_err(AppError::from)?;
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    // 乐观锁：element.updated_at 是前端加载时的版本，库里已变说明别的窗口先保存了。
    // 先查一次只为区分「条目不存在」与「版本冲突」，真正的并发保护在下面的 UPDATE WHERE。
    // 只在事务里预检是不够的：预检与 UPDATE 之间仍可能被别的进程插一脚（check-then-use 竞态）。
    // 基准为空（旧调用方没带）时跳过校验，保持兼容。
    let baseline = element.updated_at.trim();
    let current: Option<String> = tx
        .query_row(
            "select updated_at from story_element where id = ?1",
            params![element.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    let Some(current) = current else {
        return Err(AppError::not_found("设定条目不存在"));
    };
    if !baseline.is_empty() && current != baseline {
        return Err(AppError::conflict("该设定已在其它窗口被修改"));
    }
    let changed = tx
        .execute(
            r#"update story_element set kind=?2, name=?3, summary=?4, detail_json=?5,
               updated_at = case
                 when coalesce(strftime('%Y-%m-%dT%H:%M:%fZ','now'), '') > updated_at
                   then strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 else coalesce(
                   strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds'),
                   strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 )
               end
               where id=?1 and (?6 = '' or updated_at = ?6)"#,
            params![
                element.id,
                element.kind,
                element.name.trim(),
                element.summary,
                detail,
                baseline
            ],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::conflict("该设定已在其它窗口被修改，请刷新后再保存"));
    }
    // 设定文本参与索引，改动即过期（纪元按作品分键，只影响当前作品）。
    crate::services::rag::bump_content_epoch(&tx, &element.project_id)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

pub fn remove(state: &DbState, id: &str) -> Result<(), AppError> {
    {
        let conn = state.biz();
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        // 纪元按作品分键，删之前先取所属作品；条目已不存在时无需标记。
        let project_id: Option<String> = tx
            .query_row(
                "select project_id from story_element where id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)?;
        tx.execute("delete from story_element where id = ?1", params![id])
            .map_err(AppError::from)?;
        // 设定条目也被 RAG 索引过（kind = element）：片段与条目必须同事务删除。
        // 提交后再清一旦失败，已删除的设定仍会作为参考资料被检索出来。
        // 这里不依赖 project_id：条目已不存在（重复删除）时也要顺手清掉可能的残留。
        crate::services::rag::purge_source_in(&tx, id)?;
        if let Some(project_id) = project_id {
            crate::services::rag::bump_content_epoch(&tx, &project_id)?;
        }
        tx.commit().map_err(AppError::from)?;
    }
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
) -> Result<Vec<ConsistencyIssue>, AppError> {
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
mod tests;
