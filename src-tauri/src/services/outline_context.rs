//! 作品上下文组装：把作品信息、设定库、大纲与伏笔拼成可审阅的纯文本。
//! P4 的写作/Copilot 直接复用这份文本作为 system 上下文，避免各页面各拼一份。

use std::collections::HashMap;
use std::fmt::Write as _;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{Chapter, Foreshadow, Scene};
use crate::services::outline::{query_chapters, query_foreshadows, query_scenes};

/// 生成上下文所需的作品基础信息。
struct ProjectBrief {
    title: String,
    genre: String,
    premise: String,
    audience: String,
    style: String,
    privacy: String,
}

/// 设定条目精简视图：只保留进入 AI 上下文所需字段。
struct ElementBrief {
    id: String,
    kind: String,
    name: String,
    summary: String,
    aliases: Vec<String>,
    time_start: Option<String>,
    time_end: Option<String>,
    /// (目标条目 id, 关系类型)
    relations: Vec<(String, String)>,
}

fn kind_label(kind: &str) -> &'static str {
    match kind {
        "character" => "人物",
        "place" => "地点",
        "org" => "组织",
        "event" => "时间线",
        "term" => "术语",
        _ => "其他",
    }
}

fn chapter_status_label(status: &str) -> &'static str {
    match status {
        "drafting" => "写作中",
        "done" => "已完成",
        _ => "待写",
    }
}

fn foreshadow_status_label(status: &str) -> &'static str {
    match status {
        "setup" => "已铺设",
        "paid-off" => "已回收",
        _ => "待铺设",
    }
}

fn act_label(act: i64) -> &'static str {
    match act {
        2 => "第二幕",
        3 => "第三幕",
        _ => "第一幕",
    }
}

fn detail_str(detail: &Value, key: &str) -> Option<String> {
    detail
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn query_project(conn: &Connection, project_id: &str) -> Result<ProjectBrief, AppError> {
    conn.query_row(
        "select title, genre, premise, audience, style, privacy from project where id = ?1",
        params![project_id],
        |row| {
            Ok(ProjectBrief {
                title: row.get(0)?,
                genre: row.get(1)?,
                premise: row.get(2)?,
                audience: row.get(3)?,
                style: row.get(4)?,
                privacy: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("作品不存在"))
}

fn query_elements(conn: &Connection, project_id: &str) -> Result<Vec<ElementBrief>, AppError> {
    let mut stmt = conn
        .prepare(
            "select id, kind, name, summary, detail_json from story_element where project_id = ?1 \
             order by case kind \
               when 'character' then 0 when 'place' then 1 when 'org' then 2 \
               when 'event' then 3 when 'term' then 4 else 5 end, name collate nocase",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            let raw: String = row.get(4)?;
            let detail: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            let aliases = detail
                .get("aliases")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|alias| alias.trim().to_string())
                        .filter(|alias| !alias.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let relations = detail
                .get("relations")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let target = item.get("targetId").and_then(Value::as_str)?;
                            let kind = item
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or("related-to");
                            Some((target.to_string(), kind.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(ElementBrief {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                summary: row.get(3)?,
                aliases,
                time_start: detail_str(&detail, "timeStart"),
                time_end: detail_str(&detail, "timeEnd"),
                relations,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

/// 把单个章节下的场景格式化为上下文条目。
fn write_scenes(out: &mut String, scenes: &[&Scene]) {
    for (index, scene) in scenes.iter().enumerate() {
        let mut meta = Vec::new();
        if !scene.pov.trim().is_empty() {
            meta.push(format!("POV：{}", scene.pov.trim()));
        }
        if !scene.location.trim().is_empty() {
            meta.push(format!("地点：{}", scene.location.trim()));
        }
        if !scene.time_mark.trim().is_empty() {
            meta.push(format!("时间：{}", scene.time_mark.trim()));
        }
        let suffix = if meta.is_empty() {
            String::new()
        } else {
            format!("｜{}", meta.join("｜"))
        };
        let _ = writeln!(out, "- 场景 {} · {}{}", index + 1, scene.title, suffix);
        if !scene.summary.trim().is_empty() {
            let _ = writeln!(out, "  {}", scene.summary.trim());
        }
    }
    if scenes.is_empty() {
        let _ = writeln!(out, "- 暂无场景。");
    }
    let _ = writeln!(out);
}

fn write_outline(
    out: &mut String,
    chapters: &[Chapter],
    scenes: &[Scene],
    foreshadows: &[Foreshadow],
) {
    let _ = writeln!(out, "## 大纲");
    if chapters.is_empty() {
        let _ = writeln!(out, "- 暂无章节。\n");
    }
    for act in 1..=3 {
        let act_chapters: Vec<&Chapter> = chapters.iter().filter(|c| c.act == act).collect();
        if act_chapters.is_empty() {
            continue;
        }
        let _ = writeln!(out, "### {}", act_label(act));
        for chapter in act_chapters {
            let _ = writeln!(
                out,
                "#### 第 {} 章 · {}（{}）",
                chapter.sort_order + 1,
                chapter.title,
                chapter_status_label(&chapter.status)
            );
            if !chapter.summary.trim().is_empty() {
                let _ = writeln!(out, "{}", chapter.summary.trim());
            }
            let chapter_scenes: Vec<&Scene> = scenes
                .iter()
                .filter(|scene| scene.chapter_id == chapter.id)
                .collect();
            write_scenes(out, &chapter_scenes);
        }
    }

    let _ = writeln!(out, "## 伏笔");
    if foreshadows.is_empty() {
        let _ = writeln!(out, "- 暂无伏笔。");
    }
    let titles: HashMap<&str, &str> = chapters
        .iter()
        .map(|chapter| (chapter.id.as_str(), chapter.title.as_str()))
        .collect();
    for foreshadow in foreshadows {
        let setup = foreshadow
            .setup_chapter_id
            .as_deref()
            .and_then(|id| titles.get(id).copied())
            .unwrap_or("未指定");
        let payoff = foreshadow
            .payoff_chapter_id
            .as_deref()
            .and_then(|id| titles.get(id).copied())
            .unwrap_or("未指定");
        let _ = writeln!(
            out,
            "- [{}] {}：铺设「{}」→ 回收「{}」",
            foreshadow_status_label(&foreshadow.status),
            foreshadow.title,
            setup,
            payoff
        );
    }
}

fn write_elements(out: &mut String, elements: &[ElementBrief]) {
    if elements.is_empty() {
        return;
    }
    // 关系里存的是目标 id，输出前统一换成名称，方便直接塞进 AI 上下文。
    let name_by_id: HashMap<&str, &str> = elements
        .iter()
        .map(|element| (element.id.as_str(), element.name.as_str()))
        .collect();

    let _ = writeln!(out, "## 设定库");
    for kind in ["character", "place", "org", "event", "term"] {
        let group: Vec<&ElementBrief> = elements
            .iter()
            .filter(|element| element.kind == kind)
            .collect();
        if group.is_empty() {
            continue;
        }
        let _ = writeln!(out, "### {}", kind_label(kind));
        for element in group {
            let alias = if element.aliases.is_empty() {
                String::new()
            } else {
                format!("（别名：{}）", element.aliases.join("、"))
            };
            let summary = if element.summary.trim().is_empty() {
                String::new()
            } else {
                format!("：{}", element.summary.trim())
            };
            let _ = writeln!(out, "- **{}{}**{}", element.name, alias, summary);
            if element.time_start.is_some() || element.time_end.is_some() {
                let _ = writeln!(
                    out,
                    "  - 时间：{} — {}",
                    element.time_start.as_deref().unwrap_or("?"),
                    element.time_end.as_deref().unwrap_or("?")
                );
            }
            if !element.relations.is_empty() {
                let rendered: Vec<String> = element
                    .relations
                    .iter()
                    .map(|(target_id, relation)| {
                        let name = name_by_id
                            .get(target_id.as_str())
                            .copied()
                            .unwrap_or("未知目标");
                        format!("{name}（{relation}）")
                    })
                    .collect();
                let _ = writeln!(out, "  - 关联：{}", rendered.join("；"));
            }
        }
    }
    let _ = writeln!(out);
}

/// 生成作品上下文。返回 Markdown 文本，既用于界面预览，也作为 AI 的 system 上下文。
pub fn build_context(state: &DbState, project_id: &str) -> Result<String, AppError> {
    let conn = state.biz();
    let project = query_project(&conn, project_id)?;
    let elements = query_elements(&conn, project_id)?;
    let chapters = query_chapters(&conn, project_id)?;
    let scenes = query_scenes(&conn, project_id)?;
    let foreshadows = query_foreshadows(&conn, project_id)?;

    let mut out = String::new();
    let _ = writeln!(out, "# 作品上下文：《{}》\n", project.title);
    let _ = writeln!(out, "## 作品信息");
    for (label, value) in [
        ("类型", &project.genre),
        ("一句话梗概", &project.premise),
        ("目标读者", &project.audience),
        ("风格", &project.style),
    ] {
        if !value.trim().is_empty() {
            let _ = writeln!(out, "- {}：{}", label, value.trim());
        }
    }
    let privacy = if project.privacy == "local-only" {
        "仅本地模型"
    } else {
        "不限制"
    };
    let _ = writeln!(out, "- 隐私范围：{privacy}\n");

    write_elements(&mut out, &elements);
    write_outline(&mut out, &chapters, &scenes, &foreshadows);
    Ok(out)
}
