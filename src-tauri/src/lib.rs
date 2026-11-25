mod commands;
mod error;
mod infrastructure;
mod models;
mod services;

pub use error::{AppError, ErrorCode};

use std::sync::Arc;

use tauri::Manager;

use infrastructure::db;
use services::cancel::CancelRegistry;
use services::provider;

#[tauri::command]
fn ping() -> String {
    "本地运行时已就绪".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 刻意不注册 tauri-plugin-sql：数据库只经本 crate 的 service 层访问，
    // 渲染进程拿不到「任意 SQL」能力（capabilities 里也不能授予 sql:*）。
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // db::open 返回带 db 错误码的 AppError，用 ? 直接向上抛，
            // 前端才能按「数据库不可用」分支提示，而不是笼统归到 internal。
            let db_state = db::open(&dir)?;
            // 首次启动的默认 Provider 由领域服务决定（幂等，用户删过就不复活）。
            provider::ensure_default_seeded(&db_state)?;
            app.manage(db_state);
            // 用 Arc 包一层：命令层拿到的 State 里要能持有克隆出的 guard 引用计数。
            app.manage(Arc::new(CancelRegistry::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::model::list_providers,
            commands::model::save_provider,
            commands::model::remove_provider,
            commands::model::probe_provider,
            commands::model::chat_completions,
            commands::model::cancel_chat,
            commands::ollama::check_ollama,
            commands::ollama::start_ollama,
            commands::setting::get_app_setting,
            commands::setting::set_app_setting,
            commands::keychain::keychain_set,
            commands::keychain::keychain_delete,
            commands::project::database_info,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::create_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::story_element::list_story_elements,
            commands::story_element::list_all_story_elements,
            commands::story_element::get_story_element,
            commands::story_element::create_story_element,
            commands::story_element::update_story_element,
            commands::story_element::delete_story_element,
            commands::story_element::check_story_consistency,
            commands::outline::outline_snapshot,
            commands::outline::create_chapter,
            commands::outline::update_chapter,
            commands::outline::update_chapter_summary,
            commands::outline::delete_chapter,
            commands::outline::create_scene,
            commands::outline::update_scene,
            commands::outline::delete_scene,
            commands::outline::create_foreshadow,
            commands::outline::update_foreshadow,
            commands::outline::delete_foreshadow,
            commands::outline::move_chapter,
            commands::outline::move_scene,
            commands::outline::build_project_context,
            commands::draft::get_chapter_content,
            commands::draft::save_chapter_content,
            commands::draft::list_draft_versions,
            commands::draft::get_draft_version,
            commands::draft::restore_draft_version,
            commands::rag::rag_status,
            commands::rag::rag_reindex,
            commands::rag::rag_search,
            commands::publish::write_export_file,
            commands::usage::usage_stats,
            commands::stats::workspace_stats,
            commands::agent::create_agent_session,
            commands::agent::list_agent_sessions,
            commands::agent::append_agent_message,
            commands::agent::list_agent_messages,
            commands::agent::append_agent_step,
            commands::agent::list_agent_steps,
            commands::agent::agent_outcome_stats,
            commands::agent::rename_agent_session,
            commands::agent::delete_agent_session,
            commands::agent::list_agent_roles,
            commands::agent::save_agent_role,
            commands::agent::delete_agent_role,
            commands::agent::save_agent_eval_run,
            commands::agent::list_agent_eval_runs,
            commands::ideation::load_ideation_draft,
            commands::ideation::save_ideation_draft,
            commands::mcp::list_mcp_servers,
            commands::mcp::save_mcp_server,
            commands::mcp::remove_mcp_server,
            commands::mcp::list_mcp_tools,
            commands::mcp::call_mcp_tool,
            commands::mcp::issue_mcp_approval,
            commands::workflow::apply_workflow,
        ])
        .build(tauri::generate_context!());

    // 启动失败不要 panic 暴露 Rust 堆栈，改成明确的错误输出与非零退出码。
    let app = match app {
        Ok(app) => app,
        Err(err) => {
            eprintln!("启动 INK-HARNESS 失败：{err}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            shutdown_local_model(app_handle);
        }
    });
}

/// App 退出前按设置决定要不要停掉「本进程拉起」的本地模型。
/// 读设置失败时按默认（停止）处理：宁可多停一次自己起的服务，也不留后台进程。
fn shutdown_local_model(app: &tauri::AppHandle) {
    use infrastructure::db::DbState;
    use services::{ollama, setting};

    let state = app.state::<DbState>();
    let enabled =
        setting::get_bool(state.inner(), setting::STOP_OLLAMA_ON_EXIT, true).unwrap_or(true);
    if enabled {
        ollama::stop_spawned();
    }
}
