pub mod ai;
pub mod app_tracking;
pub mod attention;
pub mod commands;
pub mod database;
pub mod encryption;
pub mod idle;
pub mod insights;
pub mod privacy;
pub mod system;

use database::{connection::DatabaseConnection, repositories::settings::SettingsRepository};
use std::{
    collections::HashSet,
    sync::Mutex,
};
use tauri::Manager;

pub struct AppState {
    pub database: Mutex<DatabaseConnection>,
    /// Keys of AI classification requests currently in-flight.
    /// Prevents duplicate concurrent calls for the same content.
    pub ai_pending: Mutex<HashSet<String>>,
    pub http_client: reqwest::Client,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = DatabaseConnection::open_local().expect("failed to open local database");

    // Seed the onboarding gate from the DB so the pill stays inert until the
    // wizard is completed, even on subsequent launches.
    let onboarding_done = SettingsRepository::new(database.connection())
        .is_onboarding_completed()
        .unwrap_or(false);
    system::tray::set_onboarding_done(onboarding_done);

    tauri::Builder::default()
        .manage(AppState {
            database: Mutex::new(database),
            ai_pending: Mutex::new(HashSet::new()),
            http_client: reqwest::Client::new(),
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            system::tray::setup_tray(app)?;

            // On first launch (onboarding not complete), show the window immediately
            // instead of waiting for the user to click the tray icon.
            if !system::tray::is_onboarding_done() {
                if let Some(window) = app.handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            // Background sampling loop — runs independently of the frontend WebView so
            // tracking and the tray pill keep updating even when the system is idle,
            // the display is dimmed, or the window is hidden.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                commands::sample_and_refresh(&handle);
            });

            // Fast tray-render loop: smoothly advances the focus ring every second
            // without touching the database between full 5-second samples.
            let handle_fast = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(33)); // ~30 fps
                system::tray::fast_tray_render(&handle_fast);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tracking_status,
            commands::list_attention_events,
            commands::list_attention_events_between,
            commands::get_home_attention_narratives,
            commands::get_privacy_settings,
            commands::get_permission_status,
            commands::get_current_detection_snapshot,
            commands::record_current_attention_sample,
            commands::clear_attention_events,
            commands::clear_daily_summary,
            commands::set_collect_window_titles,
            commands::set_idle_threshold_seconds,
            commands::set_private_mode,
            commands::add_excluded_app,
            commands::remove_excluded_app,
            commands::list_classification_rules,
            commands::get_ai_classification_settings,
            commands::set_ai_classification_settings,
            commands::test_ai_config,
            commands::add_classification_rule,
            commands::delete_classification_rule,
            commands::toggle_window_compact,
            commands::export_backup,
            commands::pick_backup_file,
            commands::import_backup,
            commands::check_browser_permission,
            commands::request_accessibility_permission,
            commands::open_accessibility_settings,
            commands::open_automation_settings,
            commands::set_show_tray_label,
            commands::is_onboarding_completed,
            commands::mark_onboarding_completed,
            commands::reset_app,
            commands::save_card_image
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Flint");
}
