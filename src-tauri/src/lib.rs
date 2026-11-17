mod commands;
mod infrastructure;
mod models;
mod services;

use tauri::Manager;

use infrastructure::db;

#[tauri::command]
fn ping() -> String {
    "本地运行时已就绪".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let db_state = db::open(&dir).map_err(|e| e.to_string())?;
            app.manage(db_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::model::list_providers,
            commands::model::save_provider,
            commands::model::remove_provider,
            commands::model::probe_provider,
            commands::model::chat_completions,
            commands::ollama::check_ollama,
            commands::keychain::keychain_set,
            commands::keychain::keychain_get,
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
        ])
        .run(tauri::generate_context!())
        .expect("启动 INK-HARNESS 失败");
}
