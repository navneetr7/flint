use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    ai::{attention_summary::{summarize_attention_with_ai, AttentionSummaryResult}, classifier::classify_with_ai},
    app_tracking::tracker::AttentionTracker,
    attention::event::AttentionEvent,
    database::repositories::{
        attention_events::AttentionEventRepository, classification::ClassificationRepository,
        daily_summaries::{DailySummary, DailySummaryRepository},
        hourly_summaries::{HourlySummary, HourlySummaryRepository},
        settings::PrivacySettings, settings::SettingsRepository,
    },
    AppState,
};

#[cfg(target_os = "macos")]
use crate::idle::macos::MacOsIdleProvider;
#[cfg(target_os = "macos")]
use crate::{
    app_tracking::macos::{browser_diagnostic_for_app, MacOsActiveAppProvider},
    app_tracking::platform::ActiveAppProvider,
    idle::platform::IdleProvider,
};

#[derive(Serialize)]
pub struct TrackingStatus {
    status: String,
}

#[derive(Serialize)]
pub struct PermissionStatus {
    active_app_access: String,
    context_awareness: String,
    storage: String,
}

#[derive(Serialize)]
pub struct DetectionSnapshot {
    raw_app_name: Option<String>,
    enriched_app_name: Option<String>,
    window_title: Option<String>,
    category: Option<String>,
    is_idle: bool,
    idle_seconds: u64,
    context_awareness_enabled: bool,
    private_mode_enabled: bool,
    status: String,
    browser_status: Option<String>,
    browser_diagnostic: Option<String>,
}

#[derive(Serialize)]
pub struct HomeAttentionNarratives {
    today: HomeAttentionSection,
    previous_day: HomeAttentionSection,
}

#[derive(Serialize)]
pub struct CategoryTotal {
    category: String,
    seconds: u64,
}

#[derive(Serialize)]
pub struct HomeAttentionSection {
    label: String,
    summary: String,
    focus_seconds: u64,
    learning_seconds: u64,
    drift_seconds: u64,
    idle_seconds: u64,
    longest_focus_seconds: u64,
    top_categories: Vec<CategoryTotal>,
    what_was_off: String,
    time_wasters: Vec<String>,
    main_distractions: Vec<String>,
    tip: String,
    generated_with_ai: bool,
    error: Option<String>,
}

#[derive(Default)]
struct AttentionTotals {
    focus_seconds: u64,
    learning_seconds: u64,
    drift_seconds: u64,
    idle_seconds: u64,
    longest_focus_seconds: u64,
}

#[tauri::command]
pub fn get_tracking_status() -> TrackingStatus {
    TrackingStatus {
        status: "active".to_string(),
    }
}

#[tauri::command]
pub fn get_permission_status(state: State<AppState>) -> Result<PermissionStatus, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let settings = SettingsRepository::new(database.connection()).get_privacy_settings();

    // AXIsProcessTrusted is the only reliable check — NSWorkspace.frontmostApplication()
    // works without accessibility, so we must check the TCC grant directly.
    #[cfg(target_os = "macos")]
    let active_app_access = {
        extern "C" { fn AXIsProcessTrusted() -> bool; }
        if unsafe { AXIsProcessTrusted() } { "Ready" } else { "Unavailable" }
    };

    #[cfg(not(target_os = "macos"))]
    let active_app_access = "Unsupported";

    let context_awareness = match settings {
        Ok(settings) if settings.collect_window_titles => "Enabled",
        Ok(_) => "Off",
        Err(_) => "Unknown",
    };

    Ok(PermissionStatus {
        active_app_access: active_app_access.to_string(),
        context_awareness: context_awareness.to_string(),
        storage: "local".to_string(),
    })
}

/// Records one attention sample and refreshes the tray pill.
pub fn sample_and_refresh(app: &AppHandle) -> Option<AttentionEvent> {
    #[cfg(target_os = "macos")]
    {
        use crate::{
            database::repositories::classification::ClassificationRepository,
            AppState,
        };

        let state = app.state::<AppState>();
        let Ok(database) = state.database.lock() else { return None; };
        let tracker = AttentionTracker::new(MacOsActiveAppProvider, MacOsIdleProvider);
        let attention_events = AttentionEventRepository::new(database.connection());
        let settings = SettingsRepository::new(database.connection());
        let result = tracker.record_sample(&attention_events, &settings, 5).ok()?;
        drop(database);
        crate::system::tray::refresh_tray_title(app);

        if let Some(ref event) = result {
            let should_check_ai = event.window_title.is_some()
                || event.category == "browser"
                || event.category == "unknown";

            let pending_request = if should_check_ai {
                let Ok(db) = state.database.lock() else {
                    let _ = app.emit("attention-sampled", &result);
                    return result;
                };
                ClassificationRepository::new(db.connection())
                    .prepare_ai_request(&event.app_name, &event.window_title)
                    .ok()
                    .flatten()
            } else {
                None
            };

            if let Some(request) = pending_request {
                let key = request.target_hash.clone();
                let already_pending = {
                    let mut set = state.ai_pending.lock().unwrap_or_else(|e| e.into_inner());
                    !set.insert(key.clone())
                };
                if !already_pending {
                    let app_clone = app.clone();
                    let event_clone = event.clone();
                    tauri::async_runtime::spawn(async move {
                        classify_and_emit(app_clone, request, event_clone, key).await;
                    });
                }
                return result;
            }
        }

        let _ = app.emit("attention-sampled", &result);
        return result;
    }
    #[cfg(not(target_os = "macos"))]
    None
}

/// Retries AI once on failure; always emits "attention-sampled" even if AI fails.
#[cfg(target_os = "macos")]
async fn classify_and_emit(
    app: AppHandle,
    request: crate::database::repositories::classification::AiPendingRequest,
    event: AttentionEvent,
    pending_key: String,
) {
    use crate::{
        ai::classifier::classify_with_ai_async,
        database::repositories::classification::ClassificationRepository,
        AppState,
    };

    let timeout = std::time::Duration::from_secs(30);
    let state = app.state::<AppState>();
    let client = state.http_client.clone();

    let ai_result = {
        let first = classify_with_ai_async(
            &client,
            &request.base_url,
            &request.model,
            &request.api_key,
            &request.app_name,
            request.host.as_deref(),
            request.title.as_deref(),
            timeout,
        )
        .await;

        match first {
            Ok(r) => Some(r),
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                classify_with_ai_async(
                    &client,
                    &request.base_url,
                    &request.model,
                    &request.api_key,
                    &request.app_name,
                    request.host.as_deref(),
                    request.title.as_deref(),
                    timeout,
                )
                .await
                .ok()
            }
        }
    };

    if let Some(result) = ai_result {
        if let Ok(db) = state.database.lock() {
            let repo = ClassificationRepository::new(db.connection());
            if let Ok(classified) = repo.save_ai_result(&request, result) {
                // Patch the category on the event that triggered this AI request.
                // The tracker wrote it to the DB immediately with the seed-rule category
                // (before AI ran); update it now so the trail shows the correct state.
                let _ = db.connection().execute(
                    "UPDATE attention_events SET category = ?1 WHERE id = ?2",
                    rusqlite::params![classified.category, event.id],
                );
            }
        }
    }

    {
        let mut set = state.ai_pending.lock().unwrap_or_else(|e| e.into_inner());
        set.remove(&pending_key);
    }

    let _ = app.emit("attention-sampled", &event);
}

#[tauri::command]
pub fn record_current_attention_sample(app: AppHandle) -> Result<Option<AttentionEvent>, String> {
    Ok(sample_and_refresh(&app))
}

#[tauri::command]
pub fn is_onboarding_completed(state: State<AppState>) -> Result<bool, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    SettingsRepository::new(database.connection())
        .is_onboarding_completed()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mark_onboarding_completed(state: State<AppState>) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    SettingsRepository::new(database.connection())
        .mark_onboarding_completed()
        .map_err(|error| error.to_string())?;
    crate::system::tray::set_onboarding_done(true);
    Ok(())
}

#[tauri::command]
pub fn reset_app(state: State<AppState>) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let conn = database.connection();

    // Wipe all user data tables
    conn.execute("DELETE FROM attention_events", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM hourly_summaries", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_summaries", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ai_classifications", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ai_settings", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM excluded_apps", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM classification_rules", []).map_err(|e| e.to_string())?;

    // Reset privacy_settings row to factory defaults
    conn.execute(
        "UPDATE privacy_settings SET
            private_mode_enabled = 0,
            collect_window_titles = 0,
            idle_threshold_seconds = 300,
            show_tray_label = 0,
            focus_milestone_target_minutes = 15,
            onboarding_completed = 0
         WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Gate the pill again until onboarding is re-completed
    crate::system::tray::set_onboarding_done(false);

    // Remove Flint from macOS Accessibility and Automation permissions so the
    // next onboarding run re-prompts. Failure is non-fatal.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("tccutil")
            .args(["reset", "Accessibility", "com.flint.app"])
            .output();
        let _ = std::process::Command::new("tccutil")
            .args(["reset", "AppleEvents", "com.flint.app"])
            .output();
    }

    Ok(())
}

#[tauri::command]
pub fn set_show_tray_label(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());
    let settings = repository
        .set_show_tray_label(enabled)
        .and_then(|_| repository.get_privacy_settings())
        .map_err(|error| error.to_string())?;
    drop(database);
    crate::system::tray::refresh_tray_title(&app);
    Ok(settings)
}

#[tauri::command]
pub fn get_current_detection_snapshot(state: State<AppState>) -> Result<DetectionSnapshot, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let settings = SettingsRepository::new(database.connection())
        .get_privacy_settings()
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let app_provider = MacOsActiveAppProvider;
        let idle_state = MacOsIdleProvider.idle_state();
        let raw_app = app_provider.current_app();
        let enriched_app = raw_app.clone().map(|app| {
            if settings.collect_window_titles {
                app_provider.enrich_context(app)
            } else {
                app
            }
        });
        let status = if settings.private_mode_enabled {
            "private-mode"
        } else if idle_state.idle_seconds >= settings.idle_threshold_seconds {
            "idle"
        } else if raw_app.is_some() {
            "ready"
        } else {
            "no-active-app"
        };

        let raw_app_name = raw_app.map(|app| app.name);
        let browser_diagnostic = raw_app_name
            .as_ref()
            .map(|app_name| browser_diagnostic_for_app(app_name));
        let enriched_app_name = enriched_app.as_ref().map(|app| app.name.clone());
        let classification = if let Some(app_name) = enriched_app_name.as_ref() {
            Some(
                ClassificationRepository::new(database.connection())
                    .classify_app(app_name)
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };

        return Ok(DetectionSnapshot {
            raw_app_name,
            enriched_app_name: classification
                .as_ref()
                .map(|classified| classified.display_name.clone())
                .or(enriched_app_name),
            window_title: enriched_app.and_then(|app| app.window_title),
            category: classification.map(|classified| classified.category),
            is_idle: idle_state.idle_seconds >= settings.idle_threshold_seconds,
            idle_seconds: idle_state.idle_seconds,
            context_awareness_enabled: settings.collect_window_titles,
            private_mode_enabled: settings.private_mode_enabled,
            status: status.to_string(),
            browser_status: browser_diagnostic
                .as_ref()
                .map(|diagnostic| diagnostic.status.clone()),
            browser_diagnostic: browser_diagnostic.map(|diagnostic| diagnostic.detail),
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(DetectionSnapshot {
            raw_app_name: None,
            enriched_app_name: None,
            window_title: None,
            category: None,
            is_idle: false,
            idle_seconds: 0,
            context_awareness_enabled: settings.collect_window_titles,
            private_mode_enabled: settings.private_mode_enabled,
            status: "unsupported-platform".to_string(),
            browser_status: None,
            browser_diagnostic: None,
        })
    }
}

#[tauri::command]
pub fn list_attention_events(state: State<AppState>) -> Result<Vec<AttentionEvent>, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = AttentionEventRepository::new(database.connection());

    repository
        .list_recent(500)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_attention_events_between(
    state: State<AppState>,
    start_at: String,
    end_at: String,
) -> Result<Vec<AttentionEvent>, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = AttentionEventRepository::new(database.connection());

    repository
        .list_between(&start_at, &end_at)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_home_attention_narratives(
    state: State<AppState>,
    today_start_at: String,
    today_end_at: String,
    current_hour: u8,
    local_date: String,
    previous_start_at: String,
    previous_end_at: String,
    previous_local_date: String,
    timezone: String,
) -> Result<HomeAttentionNarratives, String> {
    let (previous_events, stored_previous, stored_hourly, ai_config) = {
        let database = state
            .database
            .lock()
            .map_err(|_| "Database lock unavailable".to_string())?;
        let events = AttentionEventRepository::new(database.connection());
        let daily = DailySummaryRepository::new(database.connection());
        let hourly = HourlySummaryRepository::new(database.connection());
        let classification = ClassificationRepository::new(database.connection());

        (
            events
                .list_between(&previous_start_at, &previous_end_at)
                .map_err(|e| e.to_string())?,
            daily.find(&previous_local_date).map_err(|e| e.to_string())?,
            hourly.list_for_date(&local_date).map_err(|e| e.to_string())?,
            classification.ai_request_config().map_err(|e| e.to_string())?,
        )
    };

    // Process at most 5 missing hourly summaries to avoid blocking the UI after a long gap.
    let summarised_hours: std::collections::HashSet<u8> =
        stored_hourly.iter().map(|s| s.hour).collect();
    let hours_needing_summary: Vec<u8> = (0..current_hour)
        .filter(|h| !summarised_hours.contains(h))
        .take(5)
        .collect();

    if !hours_needing_summary.is_empty() {
        let base_ms: i64 = chrono_millis(&today_start_at)?;
        let mut context_summaries: Vec<&HourlySummary> = stored_hourly
            .iter()
            .filter(|s| s.hour < *hours_needing_summary.first().unwrap_or(&0))
            .collect();
        let mut newly_stored: Vec<HourlySummary> = Vec::new();

        for hour in &hours_needing_summary {
            let hour_start_ms = base_ms + (*hour as i64) * 3_600_000;
            let hour_end_ms = hour_start_ms + 3_600_000;
            let hour_start_iso = ms_to_iso(hour_start_ms);
            let hour_end_iso = ms_to_iso(hour_end_ms);

            let hour_events = {
                let database = state
                    .database
                    .lock()
                    .map_err(|_| "Database lock unavailable".to_string())?;
                AttentionEventRepository::new(database.connection())
                    .list_between(&hour_start_iso, &hour_end_iso)
                    .map_err(|e| e.to_string())?
            };

            if hour_events.is_empty() {
                continue;
            }

            let totals = attention_totals(&hour_events);
            let hour_summary = if let Some(ref config) = ai_config {
                let compact = compact_event_report(&hour_events, &totals);
                let context_text = build_hourly_context(&context_summaries);
                let scope = format!("hour {hour}:00–{next}:00", next = hour + 1);
                match summarize_attention_with_ai(
                    &config.base_url,
                    &config.model,
                    &config.api_key,
                    &scope,
                    &format!("{context_text}{compact}"),
                ) {
                    Ok(result) => HourlySummary {
                        local_date: local_date.clone(),
                        hour: *hour,
                        summary: result.summary,
                        main_drift_story: result.what_was_off,
                        improvement_tip: result.tip,
                        focus_seconds: totals.focus_seconds,
                        learning_seconds: totals.learning_seconds,
                        drift_seconds: totals.drift_seconds,
                        model: config.model.clone(),
                    },
                    Err(_) => local_hourly_summary(&local_date, *hour, &hour_events, totals),
                }
            } else {
                local_hourly_summary(&local_date, *hour, &hour_events, totals)
            };

            {
                let database = state
                    .database
                    .lock()
                    .map_err(|_| "Database lock unavailable".to_string())?;
                HourlySummaryRepository::new(database.connection()).upsert(&hour_summary).map_err(|e| e.to_string())?;
            }

            newly_stored.push(hour_summary);
            context_summaries = stored_hourly
                .iter()
                .chain(newly_stored.iter())
                .filter(|s| s.hour <= *hour)
                .collect();
        }
    }

    let all_hourly = {
        let database = state
            .database
            .lock()
            .map_err(|_| "Database lock unavailable".to_string())?;
        HourlySummaryRepository::new(database.connection())
            .list_for_date(&local_date)
            .map_err(|e| e.to_string())?
    };

    let current_hour_start_ms = chrono_millis(&today_start_at)? + (current_hour as i64) * 3_600_000;
    let current_hour_events = {
        let database = state
            .database
            .lock()
            .map_err(|_| "Database lock unavailable".to_string())?;
        AttentionEventRepository::new(database.connection())
            .list_between(&ms_to_iso(current_hour_start_ms), &today_end_at)
            .map_err(|e| e.to_string())?
    };
    let _current_totals = attention_totals(&current_hour_events);

    let today_all_events = {
        let database = state
            .database
            .lock()
            .map_err(|_| "Database lock unavailable".to_string())?;
        AttentionEventRepository::new(database.connection())
            .list_between(&today_start_at, &today_end_at)
            .map_err(|e| e.to_string())?
    };

    let today_totals = attention_totals(&today_all_events);
    let today_section = build_today_from_hourly(
        &all_hourly,
        current_hour,
        today_totals,
        &today_all_events,
    );
    let today = HomeAttentionSection {
        top_categories: compute_top_categories(&today_all_events),
        ..today_section
    };

    let previous_day_section = if let Some(stored) = stored_previous {
        section_from_stored_summary("Previous day", stored)
    } else {
        let section = build_previous_day_section(
            &previous_events,
            ai_config.as_ref(),
            &previous_local_date,
            &timezone,
        );

        if section.generated_with_ai && !previous_events.is_empty() {
            let summary = DailySummary {
                local_date: previous_local_date,
                timezone,
                summary: section.summary.clone(),
                main_drift_story: section.what_was_off.clone(),
                improvement_tip: section.tip.clone(),
                time_wasters: section.time_wasters.clone(),
                main_distractions: section.main_distractions.clone(),
                focus_seconds: section.focus_seconds,
                learning_seconds: section.learning_seconds,
                drift_seconds: section.drift_seconds,
                longest_focus_seconds: section.longest_focus_seconds,
                model: ai_config
                    .as_ref()
                    .map(|c| c.model.clone())
                    .unwrap_or_else(|| "local".to_string()),
                generated_at: String::new(),
            };
            let database = state
                .database
                .lock()
                .map_err(|_| "Database lock unavailable".to_string())?;
            DailySummaryRepository::new(database.connection()).upsert(&summary).map_err(|e| e.to_string())?;
        }

        section
    };
    let previous_day = HomeAttentionSection {
        top_categories: compute_top_categories(&previous_events),
        idle_seconds: attention_totals(&previous_events).idle_seconds,
        ..previous_day_section
    };

    Ok(HomeAttentionNarratives { today, previous_day })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn build_today_from_hourly(
    _hourly: &[HourlySummary],
    _current_hour: u8,
    full_day_totals: AttentionTotals,
    today_events: &[AttentionEvent],
) -> HomeAttentionSection {
    let label = "Today so far".to_string();

    // Always generate narrative from the full day's events so every hour
    // gets equal weight rather than inheriting only the last hour's text.
    local_summary_section(&label, today_events, full_day_totals, None)
}

fn build_hourly_context(previous: &[&HourlySummary]) -> String {
    if previous.is_empty() {
        return String::new();
    }
    let mut lines = vec!["Context from earlier today:".to_string()];
    for s in previous {
        lines.push(format!("  {:02}:00 – {}", s.hour, s.summary));
    }
    lines.push(String::new());
    lines.join("\n")
}

fn local_hourly_summary(
    local_date: &str,
    hour: u8,
    events: &[AttentionEvent],
    totals: AttentionTotals,
) -> HourlySummary {
    let section = local_summary_section(
        &format!("{local_date} {:02}:00", hour),
        events,
        totals,
        None,
    );
    HourlySummary {
        local_date: local_date.to_string(),
        hour,
        summary: section.summary,
        main_drift_story: section.what_was_off,
        improvement_tip: section.tip,
        focus_seconds: section.focus_seconds,
        learning_seconds: section.learning_seconds,
        drift_seconds: section.drift_seconds,
        model: "local".to_string(),
    }
}

fn chrono_millis(iso: &str) -> Result<i64, String> {
    use time::format_description::well_known::Rfc3339;
    let dt = time::OffsetDateTime::parse(iso.trim(), &Rfc3339)
        .map_err(|e| format!("Invalid timestamp '{}': {e}", iso.trim()))?;
    Ok(dt.unix_timestamp() * 1_000 + dt.millisecond() as i64)
}

fn ms_to_iso(ms: i64) -> String {
    let secs = ms / 1_000;
    let (y, mo, d, h, mi, s) = epoch_secs_to_parts(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn epoch_secs_to_parts(secs: i64) -> (i64, i64, i64, i64, i64, i64) {
    let days = secs.div_euclid(86_400);
    let time = secs.rem_euclid(86_400);
    let h  = time / 3_600;
    let mi = (time % 3_600) / 60;
    let s  = time % 60;
    let z  = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y   = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp  = (5 * doy + 2) / 153;
    let d   = doy - (153 * mp + 2) / 5 + 1;
    let mo  = if mp < 10 { mp + 3 } else { mp - 9 };
    let y   = if mo <= 2 { y + 1 } else { y };
    (y, mo, d, h, mi, s)
}

#[tauri::command]
pub fn clear_attention_events(state: State<AppState>) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = AttentionEventRepository::new(database.connection());

    repository.delete_all().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_daily_summary(state: State<AppState>, local_date: String) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    DailySummaryRepository::new(database.connection())
        .delete(&local_date)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_privacy_settings(state: State<AppState>) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());

    repository
        .get_privacy_settings()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_private_mode(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());

    let settings = repository
        .set_private_mode(enabled)
        .and_then(|_| repository.get_privacy_settings())
        .map_err(|error| error.to_string())?;

    let _ = app.emit("privacy-settings-changed", &settings);
    Ok(settings)
}

#[tauri::command]
pub fn set_collect_window_titles(
    state: State<AppState>,
    enabled: bool,
) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());

    repository
        .set_collect_window_titles(enabled)
        .and_then(|_| repository.get_privacy_settings())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_idle_threshold_seconds(
    state: State<AppState>,
    seconds: u64,
) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());

    repository
        .set_idle_threshold_seconds(seconds)
        .and_then(|_| repository.get_privacy_settings())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_excluded_app(
    state: State<AppState>,
    app_name: String,
) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());

    repository
        .add_excluded_app(&app_name)
        .and_then(|_| repository.get_privacy_settings())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remove_excluded_app(
    state: State<AppState>,
    app_name: String,
) -> Result<PrivacySettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = SettingsRepository::new(database.connection());

    repository
        .remove_excluded_app(&app_name)
        .and_then(|_| repository.get_privacy_settings())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_classification_rules(
    state: State<AppState>,
) -> Result<Vec<crate::database::repositories::classification::ClassificationRule>, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = ClassificationRepository::new(database.connection());

    repository.list_rules().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_ai_classification_settings(
    state: State<AppState>,
) -> Result<crate::database::repositories::classification::AiSettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = ClassificationRepository::new(database.connection());

    repository
        .get_ai_settings()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_ai_classification_settings(
    state: State<AppState>,
    enabled: bool,
    api_key: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
) -> Result<crate::database::repositories::classification::AiSettings, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = ClassificationRepository::new(database.connection());

    repository
        .set_ai_settings(
            enabled,
            api_key.as_deref(),
            provider.as_deref(),
            model.as_deref(),
            base_url.as_deref(),
        )
        .and_then(|_| repository.get_ai_settings())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn test_ai_config(state: State<'_, AppState>) -> Result<String, String> {
    // Extract config while briefly holding the DB lock (synchronous, fast).
    let (base_url, model, api_key) = {
        let database = state
            .database
            .lock()
            .map_err(|_| "Database lock unavailable".to_string())?;
        let repository = ClassificationRepository::new(database.connection());
        let config = repository
            .ai_request_config()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No API key saved — save your config first".to_string())?;
        (config.base_url, config.model, config.api_key)
    };

    // Run the blocking HTTP call on a dedicated worker thread so the Tauri
    // main event loop and all other IPC commands remain fully responsive.
    let model_label = model.clone();
    tauri::async_runtime::spawn_blocking(move || {
        classify_with_ai(
            &base_url,
            &model,
            &api_key,
            "Visual Studio Code",
            None,
            Some("main.rs — Flow"),
            std::time::Duration::from_secs(30),
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(format!("✓ Connected — {model_label} responded successfully"))
}

#[tauri::command]
pub fn save_card_image(app: tauri::AppHandle, path: String, data_url: String) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dest = std::path::PathBuf::from(&path);
    if !dest.starts_with(&home) {
        return Err("Destination must be within your home directory".to_string());
    }
    let base64_data = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "Unexpected image format — expected a PNG data URL".to_string())?;
    let bytes = BASE64.decode(base64_data).map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not write file: {e}"))
}

#[tauri::command]
pub fn add_classification_rule(
    state: State<AppState>,
    token: String,
    display_name: String,
    category: String,
    match_kind: String,
) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = ClassificationRepository::new(database.connection());

    repository
        .add_rule(&token, &display_name, &category, &match_kind)
        .map_err(|error| error.to_string())?;

    // Bulk re-classify existing attention events to apply new rules
    repository
        .reclassify_all_events()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_classification_rule(state: State<AppState>, token: String) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;
    let repository = ClassificationRepository::new(database.connection());

    repository
        .delete_rule(&token)
        .map_err(|error| error.to_string())?;

    // Bulk re-classify existing attention events to apply deleted rules fallback
    repository
        .reclassify_all_events()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn toggle_window_compact(app: AppHandle, compact: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if compact {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 380.0,
                height: 580.0,
            }));
            let _ = window.set_resizable(false);
        } else {
            let _ = window.set_resizable(true);
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 1180.0,
                height: 760.0,
            }));
        }
    }
    Ok(())
}



fn build_previous_day_section(
    previous_events: &[AttentionEvent],
    ai_config: Option<&crate::database::repositories::classification::AiRequestConfig>,
    previous_local_date: &str,
    timezone: &str,
) -> HomeAttentionSection {
    let totals = attention_totals(previous_events);
    build_generated_section(
        "Previous day",
        &format!("{previous_local_date} in {timezone}"),
        previous_events,
        totals,
        ai_config,
    )
}

fn build_generated_section(
    label: &str,
    scope: &str,
    summary_events: &[AttentionEvent],
    totals: AttentionTotals,
    ai_config: Option<&crate::database::repositories::classification::AiRequestConfig>,
) -> HomeAttentionSection {
    if summary_events.is_empty() {
        return HomeAttentionSection {
            label: label.to_string(),
            summary: "No attention samples were recorded for this period.".to_string(),
            focus_seconds: totals.focus_seconds,
            learning_seconds: totals.learning_seconds,
            drift_seconds: totals.drift_seconds,
            idle_seconds: totals.idle_seconds,
            longest_focus_seconds: totals.longest_focus_seconds,
            top_categories: Vec::new(),
            what_was_off: String::new(),
            time_wasters: Vec::new(),
            main_distractions: Vec::new(),
            tip: "Keep the tracker running during work blocks to build a useful pattern.".to_string(),
            generated_with_ai: false,
            error: None,
        };
    }

    let Some(ai_config) = ai_config else {
        return local_summary_section(label, summary_events, totals, None);
    };

    let compact_report = compact_event_report(summary_events, &totals);
    match summarize_attention_with_ai(
        &ai_config.base_url,
        &ai_config.model,
        &ai_config.api_key,
        scope,
        &compact_report,
    ) {
        Ok(summary) => section_from_ai(label, totals, summary),
        Err(error) => local_summary_section(label, summary_events, totals, Some(error)),
    }
}

fn section_from_stored_summary(label: &str, summary: DailySummary) -> HomeAttentionSection {
    HomeAttentionSection {
        label: label.to_string(),
        summary: summary.summary,
        focus_seconds: summary.focus_seconds,
        learning_seconds: summary.learning_seconds,
        drift_seconds: summary.drift_seconds,
        idle_seconds: 0,
        longest_focus_seconds: summary.longest_focus_seconds,
        top_categories: Vec::new(),
        what_was_off: summary.main_drift_story,
        time_wasters: summary.time_wasters,
        main_distractions: summary.main_distractions,
        tip: summary.improvement_tip,
        generated_with_ai: summary.model != "local",
        error: None,
    }
}

fn section_from_ai(
    label: &str,
    totals: AttentionTotals,
    summary: AttentionSummaryResult,
) -> HomeAttentionSection {
    HomeAttentionSection {
        label: label.to_string(),
        summary: summary.summary,
        focus_seconds: totals.focus_seconds,
        learning_seconds: totals.learning_seconds,
        drift_seconds: totals.drift_seconds,
        idle_seconds: totals.idle_seconds,
        longest_focus_seconds: totals.longest_focus_seconds,
        top_categories: Vec::new(),
        what_was_off: summary.what_was_off,
        time_wasters: summary.time_wasters,
        main_distractions: summary.main_distractions,
        tip: summary.tip,
        generated_with_ai: true,
        error: None,
    }
}

fn local_summary_section(
    label: &str,
    events: &[AttentionEvent],
    totals: AttentionTotals,
    error: Option<String>,
) -> HomeAttentionSection {
    let top_focus = top_app_for_categories(events, &["development", "learning", "productivity"])
        .unwrap_or_else(|| "focused tools".to_string());
    let top_learning = top_app_for_categories(events, &["learning"]);
    let drift_apps = top_apps_for_categories(events, &["entertainment", "social"], 3);

    let focus_mins = minutes(totals.focus_seconds);
    let drift_mins = minutes(totals.drift_seconds);
    let learning_mins = minutes(totals.learning_seconds);
    let total_active_mins = focus_mins + drift_mins + learning_mins;

    let focus_line = if let Some(ref top_learning) = top_learning {
        format!("Most active time went to {top_focus} and {top_learning}.")
    } else {
        format!("Most active time went to {top_focus}.")
    };

    let time_line = if total_active_mins > 0 {
        let focus_pct = (focus_mins + learning_mins) * 100 / total_active_mins.max(1);
        if drift_mins > 0 {
            format!(
                "{focus_pct}% of the session was focused work — {drift_mins}m went to distractions."
            )
        } else {
            format!("{focus_pct}% of the session was focused work with no recorded distractions.")
        }
    } else {
        "No active time recorded in this period.".to_string()
    };

    let rhythm_line = if focus_mins >= 45 {
        "A solid deep-work block — attention held well across the hour.".to_string()
    } else if drift_mins > focus_mins {
        "Drift outpaced focus this period — consider a shorter distraction-free block next.".to_string()
    } else if learning_mins > 0 {
        format!("Learning added {learning_mins}m of cognitive depth alongside the focus work.")
    } else {
        "Attention was fragmented — shorter sessions with clear intent may help.".to_string()
    };

    let summary = format!("{focus_line} {time_line} {rhythm_line}");
    let what_was_off = if totals.drift_seconds == 0 {
        String::new()
    } else if drift_apps.is_empty() {
        "A brief drift occurred but there isn't enough signal to pinpoint the source.".to_string()
    } else if drift_apps.len() == 1 {
        format!("{} was the main pull away from focused work.", drift_apps[0])
    } else {
        let all_but_last = drift_apps[..drift_apps.len() - 1].join(", ");
        let last = &drift_apps[drift_apps.len() - 1];
        format!("{all_but_last} and {last} drew attention away from deep work.")
    };
    let main_distractions: Vec<String> = drift_apps.iter().take(2).cloned().collect();
    let time_wasters: Vec<String> = drift_apps.iter().take(3).cloned().collect();
    let tip = if totals.drift_seconds == 0 {
        "Keep entertainment tabs closed at session start to protect this level of focus.".to_string()
    } else {
        "Set a specific end time for the work block before opening the browser — a defined boundary reduces impulsive tab switching.".to_string()
    };

    HomeAttentionSection {
        label: label.to_string(),
        summary,
        focus_seconds: totals.focus_seconds,
        learning_seconds: totals.learning_seconds,
        drift_seconds: totals.drift_seconds,
        idle_seconds: totals.idle_seconds,
        longest_focus_seconds: totals.longest_focus_seconds,
        top_categories: Vec::new(),
        what_was_off,
        time_wasters,
        main_distractions,
        tip,
        generated_with_ai: false,
        error,
    }
}

fn compute_top_categories(events: &[AttentionEvent]) -> Vec<CategoryTotal> {
    let mut map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for event in events {
        if event.is_idle {
            continue;
        }
        *map.entry(event.category.clone()).or_insert(0) += event.duration_seconds;
    }
    let mut cats: Vec<CategoryTotal> = map
        .into_iter()
        .filter(|(_, s)| *s > 0)
        .map(|(category, seconds)| CategoryTotal { category, seconds })
        .collect();
    cats.sort_by(|a, b| b.seconds.cmp(&a.seconds));
    cats
}

fn attention_totals(events: &[AttentionEvent]) -> AttentionTotals {
    let mut totals = events.iter().fold(AttentionTotals::default(), |mut totals, event| {
        if event.is_idle {
            totals.idle_seconds += event.duration_seconds;
            return totals;
        }

        match event.category.as_str() {
            "development" | "productivity" | "browser" => {
                totals.focus_seconds += event.duration_seconds
            }
            "learning" => learning_seconds_add(&mut totals, event.duration_seconds),
            "entertainment" | "social" => totals.drift_seconds += event.duration_seconds,
            _ => {}
        }

        totals
    });
    totals.longest_focus_seconds = longest_focus_block(events);
    totals
}

fn longest_focus_block(events: &[AttentionEvent]) -> u64 {
    const IDLE_GRACE: u64 = 10 * 60;
    const ENTERTAINMENT_NOISE: u64 = 20;
    const COMMUNICATION_BREAK: u64 = 5 * 60; // long messaging session breaks deep focus
    const MIN_BLOCK: u64 = 10 * 60;

    let mut sorted: Vec<&AttentionEvent> = events.iter().collect();
    sorted.sort_by(|a, b| a.started_at.cmp(&b.started_at));

    let mut current: u64 = 0;
    let mut longest: u64 = 0;

    for event in &sorted {
        if event.is_idle {
            if event.duration_seconds > IDLE_GRACE {
                longest = longest.max(current);
                current = 0;
            }
            // within grace: streak pauses, no time added
            continue;
        }

        match event.category.as_str() {
            // Only AI-classified specific categories count as deep focus.
            // "browser" excluded: unclassified pages could be anything.
            "development" | "productivity" | "learning" => {
                current += event.duration_seconds;
            }
            "entertainment" | "social" => {
                if event.duration_seconds >= ENTERTAINMENT_NOISE {
                    longest = longest.max(current);
                    current = 0;
                }
            }
            "communication" => {
                if event.duration_seconds >= COMMUNICATION_BREAK {
                    longest = longest.max(current);
                    current = 0;
                }
                // short reply: transparent
            }
            _ => {} // browser, system, unknown: transparent (doesn't add or break)
        }
    }

    longest = longest.max(current);
    if longest >= MIN_BLOCK { longest } else { 0 }
}

fn learning_seconds_add(totals: &mut AttentionTotals, seconds: u64) {
    totals.learning_seconds += seconds;
}

fn compact_event_report(events: &[AttentionEvent], totals: &AttentionTotals) -> String {
    let total_active = totals.focus_seconds + totals.learning_seconds + totals.drift_seconds;
    let total_session = total_active + totals.idle_seconds;

    let mut lines = vec![
        format!(
            "Totals: {} session | focus={} learning={} drift={} away={}",
            fmt_duration(total_session),
            fmt_duration(totals.focus_seconds),
            fmt_duration(totals.learning_seconds),
            fmt_duration(totals.drift_seconds),
            fmt_duration(totals.idle_seconds),
        ),
        String::new(),
        "Attention trail (chronological, every app switch):".to_string(),
        "time | duration | category | app | window title".to_string(),
    ];

    // Sort all events chronologically by start time
    let mut sorted: Vec<&AttentionEvent> = events.iter().collect();
    sorted.sort_by(|a, b| a.started_at.cmp(&b.started_at));

    for event in sorted {
        let time = hhmm(&event.started_at);
        let category = if event.is_idle { "away" } else { event.category.as_str() };
        let title = event.window_title.as_deref().unwrap_or("-");
        lines.push(format!(
            "{} | {} | {} | {} | {}",
            time,
            fmt_duration(event.duration_seconds),
            category,
            event.app_name,
            title,
        ));
    }

    lines.join("\n")
}

fn fmt_duration(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    match (h, m, s) {
        (0, 0, s) => format!("{s}s"),
        (0, m, _) => format!("{m}m"),
        (h, 0, _) => format!("{h}h"),
        (h, m, _) => format!("{h}h {m}m"),
    }
}

// Extract HH:MM from an ISO-8601 timestamp string without pulling in chrono.
fn hhmm(iso: &str) -> String {
    // Format: 2025-06-07T14:32:00.000Z  — bytes 11-15 are HH:MM
    let b = iso.as_bytes();
    if b.len() >= 16 && b[10] == b'T' {
        format!("{}:{}", std::str::from_utf8(&b[11..13]).unwrap_or("??"), std::str::from_utf8(&b[14..16]).unwrap_or("??"))
    } else {
        iso.chars().take(5).collect()
    }
}

fn top_app_for_categories(events: &[AttentionEvent], categories: &[&str]) -> Option<String> {
    top_apps_for_categories(events, categories, 1).into_iter().next()
}

fn top_apps_for_categories(events: &[AttentionEvent], categories: &[&str], limit: usize) -> Vec<String> {
    let mut totals = std::collections::BTreeMap::<String, u64>::new();

    for event in events.iter().filter(|event| !event.is_idle) {
        if categories.iter().any(|category| *category == event.category) {
            *totals.entry(event.app_name.clone()).or_default() += event.duration_seconds;
        }
    }

    let mut sorted: Vec<(String, u64)> = totals.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.into_iter().take(limit).map(|(app, _)| app).collect()
}

fn minutes(seconds: u64) -> u64 {
    seconds / 60
}

/// Checks browser automation permission for a specific browser by name.
/// Works regardless of which app is currently in the foreground.
#[tauri::command]
pub fn check_browser_permission(browser_name: String) -> BrowserPermissionResult {
    #[cfg(target_os = "macos")]
    {
        let diag = browser_diagnostic_for_app(&browser_name);
        return BrowserPermissionResult {
            supported_browser: diag.supported_browser,
            browser_name: diag.browser_name,
            status: diag.status,
            detail: diag.detail,
            remediation: diag.remediation,
        };
    }

    #[cfg(not(target_os = "macos"))]
    BrowserPermissionResult {
        supported_browser: false,
        browser_name: None,
        status: "unsupported".to_string(),
        detail: "Browser permission checking is only supported on macOS.".to_string(),
        remediation: String::new(),
    }
}

#[derive(Serialize)]
pub struct BrowserPermissionResult {
    supported_browser: bool,
    browser_name: Option<String>,
    status: String,
    detail: String,
    remediation: String,
}

/// Triggers the native macOS accessibility permission prompt so the system
/// adds Flint to the Accessibility list automatically — the user only needs
/// to flip the toggle.
#[tauri::command]
pub fn request_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        use std::ffi::c_void;

        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
            // kAXTrustedCheckOptionPrompt is a CFStringRef exported by ApplicationServices
            static kAXTrustedCheckOptionPrompt: *const c_void;
        }

        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            static kCFBooleanTrue: *const c_void;
            // Treat the callback structs as opaque — we only need their addresses
            static kCFTypeDictionaryKeyCallBacks: c_void;
            static kCFTypeDictionaryValueCallBacks: c_void;
            fn CFDictionaryCreate(
                allocator: *const c_void,
                keys: *const *const c_void,
                values: *const *const c_void,
                num_values: isize,
                key_callbacks: *const c_void,
                value_callbacks: *const c_void,
            ) -> *const c_void;
            fn CFRelease(cf: *const c_void);
        }

        let keys   = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let dict = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        );
        let result = AXIsProcessTrustedWithOptions(dict);
        CFRelease(dict);
        result
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// Opens System Settings → Privacy & Security → Accessibility on macOS.
#[tauri::command]
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    crate::app_tracking::macos::open_system_settings(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
}

/// Opens System Settings → Privacy & Security → Automation on macOS.
#[tauri::command]
pub fn open_automation_settings() {
    #[cfg(target_os = "macos")]
    crate::app_tracking::macos::open_system_settings(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    );
}

const BACKUP_HEADER_V1: &str = "ATUNEBK1";
const BACKUP_HEADER_V2: &str = "ATUNEBK2";
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\x00";

#[derive(serde::Serialize)]
pub struct ExportBackupResult {
    pub path: String,
    pub key: String,
}

/// Exports an encrypted backup of the local database.
/// Generates a unique per-export key, shows a native save-file dialog, writes the
/// encrypted file, and returns both the path and the key so the user can store it.
#[tauri::command]
pub async fn export_backup(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportBackupResult, String> {
    use crate::encryption::vault::LocalVault;
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (key_bytes, key_display) = LocalVault::generate_backup_key()?;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Flint Backup", &["atbk"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let path = rx
        .await
        .map_err(|_| "Dialog closed unexpectedly".to_string())?
        .ok_or("No save location chosen")?;

    let save_path = path
        .into_path()
        .map_err(|_| "Could not resolve backup path".to_string())?;

    let sqlite_bytes = {
        let database = state
            .database
            .lock()
            .map_err(|_| "Database lock unavailable".to_string())?;
        database
            .backup_bytes()
            .map_err(|e| format!("Could not read database: {e}"))?
    };

    let encrypted = LocalVault::encrypt_with_raw_key(&sqlite_bytes, &key_bytes)
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let content = format!("{BACKUP_HEADER_V2}\n{}\n", BASE64.encode(&encrypted));
    std::fs::write(&save_path, content)
        .map_err(|e| format!("Could not write backup file: {e}"))?;

    Ok(ExportBackupResult {
        path: save_path.to_string_lossy().to_string(),
        key: key_display,
    })
}

/// Opens a native file-picker dialog and returns the chosen .atbk file path.
/// The frontend calls this first, then prompts for a password, then calls `import_backup`.
#[tauri::command]
pub async fn pick_backup_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Flint Backup", &["atbk"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });

    let maybe_path = rx
        .await
        .map_err(|_| "Dialog closed unexpectedly".to_string())?;

    Ok(maybe_path
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

/// Imports an encrypted backup from `path`, replacing all stored data.
/// For v2 backups a `password` (the key shown at export time) is required;
/// v1 backups use the device keychain key automatically.
#[tauri::command]
pub async fn import_backup(
    state: State<'_, AppState>,
    path: String,
    password: Option<String>,
) -> Result<(), String> {
    use crate::encryption::vault::LocalVault;

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read backup file: {e}"))?;

    let mut lines = content.lines();
    let header = lines.next().unwrap_or("");
    let payload_b64 = lines.next().unwrap_or("");

    let encrypted = BASE64
        .decode(payload_b64.trim())
        .map_err(|_| "Backup file is corrupted (invalid base64)".to_string())?;

    let sqlite_bytes = match header {
        h if h == BACKUP_HEADER_V2 => {
            let key_str = password.as_deref().filter(|s| !s.is_empty()).ok_or(
                "This backup requires a decryption key. Please enter the key shown when the backup was created.".to_string(),
            )?;
            let key = LocalVault::parse_backup_key(key_str)?;
            LocalVault::decrypt_with_raw_key(&encrypted, &key)
                .map_err(|_| "Decryption failed — the key may be incorrect.".to_string())?
        }
        h if h == BACKUP_HEADER_V1 => LocalVault::decrypt_bytes(&encrypted)
            .map_err(|e| format!("Decryption failed: {e}"))?,
        _ => return Err("File is not a valid Flint backup".to_string()),
    };

    if !sqlite_bytes.starts_with(SQLITE_MAGIC) {
        return Err("Backup content is not a valid SQLite database".to_string());
    }

    let mut database = state
        .database
        .lock()
        .map_err(|_| "Database lock unavailable".to_string())?;

    database
        .replace_with_backup(&sqlite_bytes)
        .map_err(|e| format!("Restore failed: {e}"))?;

    Ok(())
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

/// Checks GitHub releases for a newer version than the current build.
/// Returns Some(UpdateInfo) if an update is available, None otherwise.
/// Cached for 24 hours in the calling layer to avoid hammering the API.
#[tauri::command]
pub async fn check_for_update() -> Option<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .user_agent("flint-app")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()?;

    let resp: serde_json::Value = client
        .get("https://api.github.com/repos/navneetr7/flint/releases/latest")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let tag = resp["tag_name"].as_str()?;
    let url = resp["html_url"].as_str()?;
    let latest = tag.trim_start_matches('v');

    if semver_gt(latest, current) {
        Some(UpdateInfo { version: tag.to_string(), url: url.to_string() })
    } else {
        None
    }
}

fn semver_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> [u32; 3] {
        let mut p = v.split('.').filter_map(|x| x.parse().ok());
        [p.next().unwrap_or(0), p.next().unwrap_or(0), p.next().unwrap_or(0)]
    };
    parse(a) > parse(b)
}

/// Opens a URL in the system default browser using macOS `open`.
#[tauri::command]
pub fn open_url(url: String) {
    let _ = std::process::Command::new("open").arg(&url).spawn();
}
