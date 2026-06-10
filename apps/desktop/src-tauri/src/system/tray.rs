use ab_glyph::{Font, FontRef, GlyphId, PxScale, ScaleFont};
use image::{ImageBuffer, Rgba, RgbaImage};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering},
    OnceLock,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime,
};

use crate::{
    app_tracking::category::{is_distraction_category, is_focus_category},
    database::repositories::{
        attention_events::AttentionEventRepository, settings::SettingsRepository,
    },
    AppState,
};

const MENU_SHOW: &str = "show";
const MENU_HIDE: &str = "hide";
const MENU_TOGGLE_TRACKING: &str = "toggle_tracking";
const MENU_QUIT: &str = "quit";

static SF_FONT: OnceLock<Vec<u8>> = OnceLock::new();

// ── Amazing! / milestone state ────────────────────────────────────────────────
static LAST_ANNOUNCED_BLOCK: AtomicU64 = AtomicU64::new(0);
static AMAZING_UNTIL_SECS: AtomicU64 = AtomicU64::new(0);
// f32 bits: 0.0 = transparent, 1.0 = opaque. Fast loop fades in/out.
static AMAZING_ALPHA: AtomicU32 = AtomicU32::new(0);

// Focus history older than this is ignored (prevents carry-over across restarts).
static APP_START_UNIX: AtomicU64 = AtomicU64::new(0);

// ── Progress ring state ───────────────────────────────────────────────────────
// Frozen during distraction; base + sample_unix enable 1s interpolation between 5s DB samples.
static FOCUS_RING_SECS: AtomicU64 = AtomicU64::new(0);
static FOCUS_RING_BASE_SECS: AtomicU64 = AtomicU64::new(0);
static FOCUS_RING_SAMPLE_UNIX: AtomicU64 = AtomicU64::new(0);
static LAST_SAMPLE_IS_FOCUS: AtomicBool = AtomicBool::new(false);
static LAST_DURATION_SECS: AtomicU64 = AtomicU64::new(0);

// ── Distraction / refocus state ───────────────────────────────────────────────
static WAS_EVER_FOCUSED: AtomicBool = AtomicBool::new(false);
static FOCUS_LEFT_AT_SECS: AtomicU64 = AtomicU64::new(0);
static DISTRACTION_ALERTED: AtomicBool = AtomicBool::new(false);
static DISTRACTION_ALERT_UNTIL_SECS: AtomicU64 = AtomicU64::new(0);
static STREAK_PAUSED: AtomicBool = AtomicBool::new(false);
static LONG_DISTRACTION_ALERTED: AtomicBool = AtomicBool::new(false);

// Deadline for the in-pill drift notice; clears on focus return or after 60 s.
static DRIFT_NOTICE_UNTIL_SECS: AtomicU64 = AtomicU64::new(0);
// Which message to show: category (0=generic 1=video 2=social) + rotation index (0-5).
static DRIFT_MSG_CAT: AtomicU8 = AtomicU8::new(0);
static DRIFT_MSG_IDX_GENERIC: AtomicU8 = AtomicU8::new(0);
static DRIFT_MSG_IDX_VIDEO:   AtomicU8 = AtomicU8::new(0);
static DRIFT_MSG_IDX_SOCIAL:  AtomicU8 = AtomicU8::new(0);

const DRIFT_MSGS_GENERIC: [&str; 6] = [
    "Still on purpose?",
    "Lost the thread?",
    "What changed?",
    "Where did focus go?",
    "Was this intentional?",
    "Return when ready.",
];
const DRIFT_MSGS_VIDEO: [&str; 6] = [
    "Still watching?",
    "Did you find it?",
    "Another video?",
    "Looking or lingering?",
    "Still exploring?",
    "Worth another minute?",
];
const DRIFT_MSGS_SOCIAL: [&str; 6] = [
    "Still scrolling?",
    "Looking for something?",
    "Another post?",
    "Still searching?",
    "Did you find it?",
    "Worth another minute?",
];

fn pick_drift_message(category: &str) -> &'static str {
    let cat_id = match category {
        "entertainment" => 1u8,
        "social"        => 2u8,
        _               => 0u8,
    };
    DRIFT_MSG_CAT.store(cat_id, Ordering::Relaxed);
    match cat_id {
        1 => {
            let idx = DRIFT_MSG_IDX_VIDEO.fetch_add(1, Ordering::Relaxed) % 6;
            DRIFT_MSGS_VIDEO[idx as usize]
        }
        2 => {
            let idx = DRIFT_MSG_IDX_SOCIAL.fetch_add(1, Ordering::Relaxed) % 6;
            DRIFT_MSGS_SOCIAL[idx as usize]
        }
        _ => {
            let idx = DRIFT_MSG_IDX_GENERIC.fetch_add(1, Ordering::Relaxed) % 6;
            DRIFT_MSGS_GENERIC[idx as usize]
        }
    }
}

fn current_drift_message() -> &'static str {
    // Return the last-picked message (index was already incremented, so step back one).
    match DRIFT_MSG_CAT.load(Ordering::Relaxed) {
        1 => {
            let idx = DRIFT_MSG_IDX_VIDEO.load(Ordering::Relaxed).wrapping_sub(1) % 6;
            DRIFT_MSGS_VIDEO[idx as usize]
        }
        2 => {
            let idx = DRIFT_MSG_IDX_SOCIAL.load(Ordering::Relaxed).wrapping_sub(1) % 6;
            DRIFT_MSGS_SOCIAL[idx as usize]
        }
        _ => {
            let idx = DRIFT_MSG_IDX_GENERIC.load(Ordering::Relaxed).wrapping_sub(1) % 6;
            DRIFT_MSGS_GENERIC[idx as usize]
        }
    }
}

// ── Onboarding gate ───────────────────────────────────────────────────────────
// Suppresses sampling and pill animation until onboarding is marked complete.
static ONBOARDING_DONE: AtomicBool = AtomicBool::new(false);

pub fn set_onboarding_done(done: bool) {
    ONBOARDING_DONE.store(done, Ordering::Relaxed);
}

pub fn is_onboarding_done() -> bool {
    ONBOARDING_DONE.load(Ordering::Relaxed)
}

/// Resets the tray pill to the idle "Flint" state. Called after app reset so the
/// old focus/drift pill clears immediately rather than staying frozen.
pub fn clear_tray_pill(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("flint") else { return; };
    if let Some(png) = render_flint_pill() {
        if let Ok(icon) = tauri::image::Image::from_bytes(&png) {
            let _ = tray.set_icon(Some(icon));
        }
    }
    let _ = tray.set_title::<&str>(None);
}

// ── Animation state ───────────────────────────────────────────────────────────
static LAST_CATEGORY_ID: AtomicU8 = AtomicU8::new(0);
static TARGET_OUTER_W: AtomicU32 = AtomicU32::new(0);
static ANIM_OUTER_W: AtomicU32 = AtomicU32::new(0);
static LAST_RENDERED_RING: AtomicU32 = AtomicU32::new(0);

fn load_font() -> &'static [u8] {
    SF_FONT.get_or_init(|| {
        // SFNS.ttf = SF NS Regular (system UI weight); SFCompact.ttf is Black weight (too heavy)
        std::fs::read("/System/Library/Fonts/SFNS.ttf")
            .or_else(|_| std::fs::read("/System/Library/Fonts/HelveticaNeue.ttc"))
            .or_else(|_| std::fs::read("/System/Library/Fonts/Helvetica.ttc"))
            .unwrap_or_default()
    })
}


fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── tray lifecycle ────────────────────────────────────────────────────────────

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    APP_START_UNIX.store(now_secs(), Ordering::Relaxed);

    let handle = app.handle().clone();
    let menu = build_tray_menu(app.handle())?;

    // Render the pill immediately so the old PNG icon never appears even for a frame.
    let initial_icon = render_flint_pill()
        .as_deref()
        .and_then(|png| Image::from_bytes(png).ok());

    let mut tray = TrayIconBuilder::with_id("flint")
        .menu(&menu)
        .tooltip("Flint")
        .show_menu_on_left_click(true)
        .icon_as_template(false)
        .on_menu_event(move |app, event| handle_tray_menu(app, event.id().as_ref()));

    if let Some(icon) = initial_icon {
        tray = tray.icon(icon);
    }

    // Refresh menu/pill on every click so stats are current when the menu opens.
    tray.on_tray_icon_event(move |_tray, event| {
        if let TrayIconEvent::Click {
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            refresh_tray_menu(&handle);
            refresh_tray_title(&handle);
        }
    })
    .build(app)?;

    Ok(())
}

fn handle_tray_menu(app: &AppHandle, menu_id: &str) {
    match menu_id {
        MENU_SHOW => show_main_window(app),
        MENU_HIDE => hide_main_window(app),
        MENU_TOGGLE_TRACKING => toggle_private_mode(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_private_mode(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(database) = state.database.lock() else {
        return;
    };
    let repository = SettingsRepository::new(database.connection());
    let enabled = repository
        .get_privacy_settings()
        .map(|s| !s.private_mode_enabled)
        .unwrap_or(true);

    if repository.set_private_mode(enabled).is_ok() {
        if let Ok(settings) = repository.get_privacy_settings() {
            let _ = app.emit("privacy-settings-changed", settings);
        }
    }

    drop(database);
    refresh_tray_menu(app);
}

fn refresh_tray_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("flint") else {
        return;
    };
    if let Ok(menu) = build_tray_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn refresh_tray_title(app: &AppHandle) {
    if !ONBOARDING_DONE.load(Ordering::Relaxed) { return; }
    let Some(tray) = app.tray_by_id("flint") else {
        return;
    };
    let state = app.state::<AppState>();
    let Ok(database) = state.database.lock() else {
        return;
    };

    let settings = SettingsRepository::new(database.connection())
        .get_privacy_settings()
        .ok();
    let show = settings.as_ref().map(|s| s.show_tray_label).unwrap_or(true);

    if !show {
        if let Some(png) = render_flint_pill() {
            if let Ok(icon) = Image::from_bytes(&png) {
                let _ = tray.set_icon(Some(icon));
                let _ = tray.set_title(None::<&str>);
            }
        }
        return;
    }

    let events = AttentionEventRepository::new(database.connection())
        .list_recent(720)  // 720 × 5s = 1 hour; enough for any milestone target
        .unwrap_or_default();

    let Some(latest) = events.first() else {
        return;
    };

    let category = latest.category.clone();
    let is_idle = latest.is_idle;
    let is_focus = !is_idle && is_focus_category(&category);
    let is_distraction = !is_idle && is_distraction_category(&category);
    LAST_CATEGORY_ID.store(encode_category(&category, is_idle), Ordering::Relaxed);

    let duration: u64 = if is_focus {
        // Sum focus seconds up to this session; clip events that span the restart boundary.
        let session_age_secs = now_secs()
            .saturating_sub(APP_START_UNIX.load(Ordering::Relaxed));
        let mut focus_total = 0u64;
        let mut gap_secs = 0u64;
        let mut walked_secs = 0u64;
        for event in &events {
            let available = session_age_secs.saturating_sub(walked_secs);
            if available == 0 { break; }
            let portion = event.duration_seconds.min(available);
            walked_secs += event.duration_seconds;

            let event_is_focus = !event.is_idle && is_focus_category(&event.category);
            if event_is_focus {
                focus_total += portion;
                gap_secs = 0;
            } else {
                gap_secs += portion;
                if gap_secs >= 240 {
                    break;
                }
            }

            if walked_secs >= session_age_secs { break; }
        }
        focus_total
    } else {
        events
            .iter()
            .take_while(|e| e.category == category && e.is_idle == is_idle)
            .map(|e| e.duration_seconds)
            .sum()
    };

    // Runs before storing LAST_DURATION_SECS to prevent a one-frame timer flash on milestone.
    let amazing_just_fired = tick_amazing_state(&category, duration, is_idle);

    LAST_SAMPLE_IS_FOCUS.store(is_focus, Ordering::Relaxed);
    LAST_DURATION_SECS.store(duration, Ordering::Relaxed);
    if is_focus {
        let now_unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        FOCUS_RING_BASE_SECS.store(duration, Ordering::Relaxed);
        FOCUS_RING_SAMPLE_UNIX.store(now_unix, Ordering::Relaxed);
        FOCUS_RING_SECS.store(duration, Ordering::Relaxed);
        STREAK_PAUSED.store(false, Ordering::Relaxed);
    }

    drop(database);
    if amazing_just_fired {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(5));
            AMAZING_UNTIL_SECS.store(0, Ordering::Relaxed);
            // Wait for fade-out (~300ms) before re-rendering normal pill.
            std::thread::sleep(std::time::Duration::from_millis(350));
            refresh_tray_title(&app_clone);
        });
    }

    let (refocus_fired, deep_drift_fired) = tick_distraction_state(app, &category, is_idle, is_distraction, duration);
    if refocus_fired {
        play_sound("Tink");
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(7));
            DISTRACTION_ALERT_UNTIL_SECS.store(0, Ordering::Relaxed);
            refresh_tray_title(&app_clone);
        });
    }
    if deep_drift_fired {
        // Louder, distinct sound so it cuts through even with headphones on.
        play_sound("Glass");
        // System notification — visible even when full-screen on YouTube/Twitter.
        send_drift_notification(&category);
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(60));
            DRIFT_NOTICE_UNTIL_SECS.store(0, Ordering::Relaxed);
            refresh_tray_title(&app_clone);
        });
    }

    let ring_progress = {
        let ring_secs = FOCUS_RING_SECS.load(Ordering::Relaxed);
        let block = ring_secs / 900;
        // Fill toward next 15-min milestone; AMAZING overlay hides the reset at each boundary.
        let next_milestone = (block + 1) * 900;
        (ring_secs as f32 / next_milestone as f32).clamp(0.0, 1.0)
    };

    if let Some(png) = render_pill(&category, duration, is_idle, ring_progress, None) {
        if let Ok(icon) = Image::from_bytes(&png) {
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_title(None::<&str>);
        }
    }

}

/// Called at ~30 fps. Animates the pill width with exponential easing (macOS-style spring)
/// and advances the ring between DB samples — no database access.
pub fn fast_tray_render(app: &AppHandle) {
    if !ONBOARDING_DONE.load(Ordering::Relaxed) { return; }
    let target_w = TARGET_OUTER_W.load(Ordering::Relaxed);
    if target_w == 0 { return; }

    let now_unix = now_secs();

    // 1/8 step → ~267ms (8 frames × 33ms) for a full fade in or out.
    const FADE_STEP: f32 = 1.0 / 8.0;
    let amazing_window = AMAZING_UNTIL_SECS.load(Ordering::Relaxed) > now_unix;
    let alpha_bits = AMAZING_ALPHA.load(Ordering::Relaxed);
    let cur_alpha = f32::from_bits(alpha_bits);
    let new_alpha = if amazing_window {
        (cur_alpha + FADE_STEP).min(1.0)
    } else if cur_alpha > 0.0 {
        (cur_alpha - FADE_STEP).max(0.0)
    } else {
        0.0
    };
    let alpha_changed = (new_alpha - cur_alpha).abs() > 0.001;
    if alpha_changed {
        AMAZING_ALPHA.store(new_alpha.to_bits(), Ordering::Relaxed);
    }
    let amazing_visible = new_alpha > 0.001;

    // Animate outer_w toward target with exponential decay (~300ms settle).
    let cur_bits = ANIM_OUTER_W.load(Ordering::Relaxed);
    let cur_w = if cur_bits == 0 { target_w as f32 } else { f32::from_bits(cur_bits) };
    let decay = (-14.0f32 * 0.033_f32).exp();
    let new_w = {
        let w = target_w as f32 + (cur_w - target_w as f32) * decay;
        if (w - target_w as f32).abs() < 0.5 { target_w as f32 } else { w }
    };
    ANIM_OUTER_W.store(new_w.to_bits(), Ordering::Relaxed);
    let width_animating = (new_w - target_w as f32).abs() > 0.5;

    let is_focus = LAST_SAMPLE_IS_FOCUS.load(Ordering::Relaxed);

    if amazing_window && !alpha_changed && !width_animating { return; }
    if !is_focus && !width_animating && !amazing_visible && !is_drift_notice_active() { return; }
    if STREAK_PAUSED.load(Ordering::Relaxed) && !width_animating && !amazing_visible { return; }

    // Ring interpolation: cumulative fill toward next 15-min milestone.
    let base = FOCUS_RING_BASE_SECS.load(Ordering::Relaxed);
    let sample_ts = FOCUS_RING_SAMPLE_UNIX.load(Ordering::Relaxed);
    let elapsed = now_unix.saturating_sub(sample_ts);
    let ring_secs_raw = base + elapsed;
    let ring_progress = if !amazing_visible {
        let block = ring_secs_raw / 900;
        let next_milestone = (block + 1) * 900;
        // Cap one second below milestone so the arc never completes before the DB
        // confirms the new block (which triggers AMAZING and hides the reset).
        let capped = ring_secs_raw.min(next_milestone - 1);
        (capped as f32 / next_milestone as f32).clamp(0.0, 1.0)
    } else {
        0.0 // AMAZING branch ignores ring_progress
    };

    let last_ring = f32::from_bits(LAST_RENDERED_RING.load(Ordering::Relaxed));
    if !width_animating && !alpha_changed && (ring_progress - last_ring).abs() < 0.001 { return; }
    LAST_RENDERED_RING.store(ring_progress.to_bits(), Ordering::Relaxed);

    let (category, is_idle) = decode_category(LAST_CATEGORY_ID.load(Ordering::Relaxed));
    let duration = if is_focus {
        LAST_DURATION_SECS.load(Ordering::Relaxed) + elapsed
    } else {
        LAST_DURATION_SECS.load(Ordering::Relaxed)
    };

    let Some(tray) = app.tray_by_id("flint") else { return; };
    if let Some(png) = render_pill(category, duration, is_idle, ring_progress, Some(new_w as u32)) {
        if let Ok(icon) = Image::from_bytes(&png) {
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_title(None::<&str>);
        }
    }
}

fn is_ring_category(category: &str) -> bool {
    matches!(category, "development" | "productivity" | "learning")
}

fn encode_category(category: &str, is_idle: bool) -> u8 {
    if is_idle { return 8; }
    match category {
        "development"   => 0,
        "productivity"  => 1,
        "learning"      => 2,
        "browser"       => 3,
        "communication" => 4,
        "entertainment" => 5,
        "social"        => 6,
        "games"         => 7,
        "system"        => 9,
        _               => 10,
    }
}

fn decode_category(id: u8) -> (&'static str, bool) {
    match id {
        0  => ("development",   false),
        1  => ("productivity",  false),
        2  => ("learning",      false),
        3  => ("browser",       false),
        4  => ("communication", false),
        5  => ("entertainment", false),
        6  => ("social",        false),
        7  => ("games",         false),
        8  => ("idle",          true),
        9  => ("system",        false),
        _  => ("unknown",       false),
    }
}

fn play_sound(name: &str) {
    let path = format!("/System/Library/Sounds/{}.aiff", name);
    let _ = std::process::Command::new("afplay").arg(&path).spawn();
}

fn send_drift_notification(_category: &str) {
    let msg = current_drift_message();
    let title = "Flint — 10 min drift";
    // osascript fires a native macOS notification visible even in full-screen.
    let script = format!(
        "display notification {} with title {}",
        shell_quote(msg),
        shell_quote(title),
    );
    let _ = std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn();
}

fn shell_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\\\"").replace('\'', "\\'"))
}

// ── Amazing! state machine ────────────────────────────────────────────────────

// Returns true when a new 15-min block just completed.
// Target is derived dynamically: block N completes at (N * 900) seconds.
fn tick_amazing_state(category: &str, duration_seconds: u64, is_idle: bool) -> bool {
    let is_focus = !is_idle && is_focus_category(category);
    if !is_focus {
        // Don't reset LAST_ANNOUNCED_BLOCK here — a brief tab-out would re-trigger AMAZING.
        return false;
    }

    let block = duration_seconds / 900;
    if block == 0 {
        return false;
    }

    let last = LAST_ANNOUNCED_BLOCK.load(Ordering::Relaxed);
    // Reset if duration went backward (new session after streak break)
    if block < last {
        LAST_ANNOUNCED_BLOCK.store(0, Ordering::Relaxed);
    }

    let last = LAST_ANNOUNCED_BLOCK.load(Ordering::Relaxed);
    if block > last {
        LAST_ANNOUNCED_BLOCK.store(block, Ordering::Relaxed);
        AMAZING_UNTIL_SECS.store(now_secs() + 5, Ordering::Relaxed);
        // Start opaque; fast loop fades out after the 5s window closes.
        AMAZING_ALPHA.store((1.0f32).to_bits(), Ordering::Relaxed);
        return true;
    }
    false
}

/// Return achievement label for completed 15-min focus block (tiers: 15m / 30m+ / 60m+).
fn achievement_label(block: u64) -> &'static str {
    if block == 0 { return "LOCKED IN"; }
    let duration = block * 900;
    if duration >= 3600 {
        let labels = ["PEAK FOCUS", "LEGENDARY", "UNSTOPPABLE", "ELITE FOCUS"];
        let first_tier_block = 4u64;
        labels[((block - first_tier_block) as usize) % labels.len()]
    } else if duration >= 1800 {
        let labels = ["DEEP WORK", "CRUSHING IT", "FLOW STATE", "ON FIRE"];
        let first_tier_block = 2u64;
        labels[((block - first_tier_block) as usize) % labels.len()]
    } else {
        let labels = ["LOCKED IN", "IN THE ZONE", "DIALED IN", "STAYING SHARP"];
        let first_tier_block = 1u64;
        labels[((block - first_tier_block) as usize) % labels.len()]
    }
}

fn is_amazing_active() -> bool {
    AMAZING_UNTIL_SECS.load(Ordering::Relaxed) > now_secs()
        || f32::from_bits(AMAZING_ALPHA.load(Ordering::Relaxed)) > 0.001
}

// ── Distraction state machine ─────────────────────────────────────────────────
// Timeline: silent → 2m "Refocus?" nudge → 4m streak pause → 10m "Still here?" prompt.

// Returns (refocus_fired, deep_drift_fired).
fn tick_distraction_state(
    _app: &AppHandle,
    category: &str,
    is_idle: bool,
    is_distraction: bool,
    _distraction_duration_secs: u64,
) -> (bool, bool) {
    let is_focus = !is_idle && is_focus_category(category);

    if is_focus {
        WAS_EVER_FOCUSED.store(true, Ordering::Relaxed);
        FOCUS_LEFT_AT_SECS.store(0, Ordering::Relaxed);
        DISTRACTION_ALERTED.store(false, Ordering::Relaxed);
        STREAK_PAUSED.store(false, Ordering::Relaxed);
        LONG_DISTRACTION_ALERTED.store(false, Ordering::Relaxed);
        DRIFT_NOTICE_UNTIL_SECS.store(0, Ordering::Relaxed);
        return (false, false);
    }

    // Idle (screensaver, sleep, AFK) — don't count as active distraction time.
    if is_idle {
        return (false, false);
    }

    if !WAS_EVER_FOCUSED.load(Ordering::Relaxed) {
        return (false, false);
    }

    let left_at = FOCUS_LEFT_AT_SECS.load(Ordering::Relaxed);
    if left_at == 0 {
        FOCUS_LEFT_AT_SECS.store(now_secs(), Ordering::Relaxed);
        return (false, false);
    }

    let away_secs = now_secs().saturating_sub(left_at);

    // Pause streak at 4 min (silent)
    if away_secs >= 240 && !STREAK_PAUSED.load(Ordering::Relaxed) {
        STREAK_PAUSED.store(true, Ordering::Relaxed);
    }

    // Deep-drift alert at 10 min — fires a system notification + in-pill message.
    // Science: dopamine engagement on social/video locks in at 5–7 min; at 10 min
    // original intent is almost always forgotten (Gloria Mark, UC Irvine).
    if away_secs >= 600
        && is_distraction
        && !LONG_DISTRACTION_ALERTED.load(Ordering::Relaxed)
    {
        LONG_DISTRACTION_ALERTED.store(true, Ordering::Relaxed);
        pick_drift_message(category); // pick + store before firing
        DRIFT_NOTICE_UNTIL_SECS.store(now_secs() + 60, Ordering::Relaxed);
        return (false, true);
    }

    // First nudge at 2 min — only when actively on a distraction category (not idle).
    if away_secs >= 120
        && is_distraction
        && !DISTRACTION_ALERTED.load(Ordering::Relaxed)
    {
        DISTRACTION_ALERTED.store(true, Ordering::Relaxed);
        DISTRACTION_ALERT_UNTIL_SECS.store(now_secs() + 7, Ordering::Relaxed);
        return (true, false);
    }

    (false, false)
}

fn is_distraction_alert_active() -> bool {
    DISTRACTION_ALERT_UNTIL_SECS.load(Ordering::Relaxed) > now_secs()
}

fn is_drift_notice_active() -> bool {
    DRIFT_NOTICE_UNTIL_SECS.load(Ordering::Relaxed) > now_secs()
}

fn distraction_elapsed_secs() -> u64 {
    let left_at = FOCUS_LEFT_AT_SECS.load(Ordering::Relaxed);
    if left_at == 0 { return 0; }
    now_secs().saturating_sub(left_at)
}

// ── pill renderer ─────────────────────────────────────────────────────────────

fn render_flint_pill() -> Option<Vec<u8>> {
    let font_data = load_font();
    if font_data.is_empty() { return None; }
    let font = FontRef::try_from_slice(font_data).ok()?;
    let scale = PxScale::from(FONT_PX);

    let text_w = measure_w(&font, scale, "Flint");
    let outer_w = OUTER_PAD_L + text_w + OUTER_PAD_R;

    let mut img: RgbaImage = ImageBuffer::from_pixel(outer_w, OUTER_H, Rgba([0, 0, 0, 0]));
    fill_capsule(&mut img, 0, 0, outer_w, OUTER_H, [14, 14, 18, 255]);

    let baseline = text_baseline(&font, scale, OUTER_H);
    let x = OUTER_PAD_L as f32;
    let color = [255, 255, 255, 255];
    draw_text(&mut img, &font, scale, "Flint", x, baseline, color);
    draw_text(&mut img, &font, scale, "Flint", x + 0.5, baseline, color);
    draw_text(&mut img, &font, scale, "Flint", x + 1.0, baseline, color);

    let mut buf: Vec<u8> = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, outer_w, OUTER_H);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_pixel_dims(Some(png::PixelDimensions {
            xppu: PNG_PPM, yppu: PNG_PPM, unit: png::Unit::Meter,
        }));
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&img.into_raw()).ok()?;
    }
    Some(buf)
}

// Render at 2× tray height (52px) for Retina sharpness; all values are raw render pixels.
const FONT_PX: f32 = 30.0;
const TIMER_FONT_PX: f32 = 26.0;
const AMAZING_FONT_PX: f32 = 28.0;

const OUTER_H: u32 = 52;
const OUTER_PAD_L: u32 = 32;
const OUTER_PAD_R: u32 = 26;
const GAP: u32 = 20;

const INNER_H: u32 = 36;
const INNER_MARGIN_V: u32 = (OUTER_H - INNER_H) / 2;
const INNER_PAD_H: u32 = 22;
const BADGE_BORDER: u32 = 4;

const PNG_PPM: u32 = 5669;

fn render_pill(category: &str, duration_seconds: u64, is_idle: bool, ring_progress: f32, outer_w_override: Option<u32>) -> Option<Vec<u8>> {
    let font_data = load_font();
    if font_data.is_empty() { return None; }
    let font = FontRef::try_from_slice(font_data).ok()?;

    let label_scale = PxScale::from(FONT_PX);
    let timer_scale = PxScale::from(TIMER_FONT_PX);
    let amazing_scale = PxScale::from(AMAZING_FONT_PX);

    let amazing = is_amazing_active();
    let distraction = is_distraction_alert_active();
    let is_ring_cat = !is_idle && is_ring_category(category);

    if amazing {
        let block = LAST_ANNOUNCED_BLOCK.load(Ordering::Relaxed);
        let label = achievement_label(block);
        // --color-recovery-teal: #60A8A0 — same teal as the focus ring arc
        let teal = [96, 168, 160, 255];
        let text_w = measure_w(&font, amazing_scale, label);
        let natural_w = OUTER_PAD_L + text_w + OUTER_PAD_R;
        if outer_w_override.is_none() {
            TARGET_OUTER_W.store(natural_w, Ordering::Relaxed);
            ANIM_OUTER_W.store((natural_w as f32).to_bits(), Ordering::Relaxed);
        }
        let min_w = OUTER_PAD_L + text_w + 4;
        let outer_w = outer_w_override
            .map(|ow| ow.max(min_w))
            .unwrap_or(natural_w);

        let mut img: RgbaImage = ImageBuffer::from_pixel(outer_w, OUTER_H, Rgba([0, 0, 0, 0]));
        fill_capsule(&mut img, 0, 0, outer_w, OUTER_H, [8, 22, 20, 255]);
        let baseline = text_baseline(&font, amazing_scale, OUTER_H);
        for dx in 0..3 {
            draw_text(&mut img, &font, amazing_scale, label, OUTER_PAD_L as f32 + dx as f32 * 0.4, baseline, teal);
        }
        let fade = f32::from_bits(AMAZING_ALPHA.load(Ordering::Relaxed)).clamp(0.0, 1.0);
        if fade < 0.999 {
            for pixel in img.pixels_mut() {
                pixel[3] = (pixel[3] as f32 * fade) as u8;
            }
        }
        return encode_png(img, outer_w, OUTER_H);
    }

    if is_drift_notice_active() {
        // Plain text only — no badge, no timer, no category label.
        let msg = current_drift_message();
        let text_w  = measure_w(&font, label_scale, msg);
        let natural_w = OUTER_PAD_L + text_w + OUTER_PAD_R;

        if outer_w_override.is_none() {
            TARGET_OUTER_W.store(natural_w, Ordering::Relaxed);
            if ANIM_OUTER_W.load(Ordering::Relaxed) == 0 {
                ANIM_OUTER_W.store((natural_w as f32).to_bits(), Ordering::Relaxed);
            }
        }
        let outer_w = outer_w_override
            .or_else(|| {
                let bits = ANIM_OUTER_W.load(Ordering::Relaxed);
                if bits != 0 { Some(f32::from_bits(bits) as u32) } else { None }
            })
            .map(|ow| ow.max(OUTER_PAD_L + text_w + 4))
            .unwrap_or(natural_w);

        // --color-drift-magenta: #C070A0 for entertainment/social, amber for generic
        let (bg, text_col) = match DRIFT_MSG_CAT.load(Ordering::Relaxed) {
            1 | 2 => ([24, 10, 20, 255], [192, 112, 160, 255]),
            _     => ([38, 18,  0, 255], [203, 155,  38, 255]),
        };
        let mut img: RgbaImage = ImageBuffer::from_pixel(outer_w, OUTER_H, Rgba([0, 0, 0, 0]));
        fill_capsule(&mut img, 0, 0, outer_w, OUTER_H, bg);
        let baseline = text_baseline(&font, label_scale, OUTER_H);
        draw_text(&mut img, &font, label_scale, msg,
            OUTER_PAD_L as f32, baseline, text_col);

        return encode_png(img, outer_w, OUTER_H);
    }

    let label = if distraction {
        "Refocus?"
    } else {
        category_label(category, is_idle)
    };

    let badge_text = if distraction {
        let secs = distraction_elapsed_secs();
        if secs < 60 { format!("{}s away", secs) }
        else { let m = secs / 60; if m == 1 { "1m away".to_string() } else { format!("{}m away", m) } }
    } else {
        format_timer(category, duration_seconds, is_idle)
    };

    let label_w = measure_w(&font, label_scale, label);
    let badge_text_w = measure_w(&font, timer_scale, &badge_text);
    let inner_w = INNER_PAD_H * 2 + badge_text_w;
    let natural_w = OUTER_PAD_L + label_w + GAP + inner_w + OUTER_PAD_R;
    if outer_w_override.is_none() {
        TARGET_OUTER_W.store(natural_w, Ordering::Relaxed);
        if ANIM_OUTER_W.load(Ordering::Relaxed) == 0 {
            // Seed on first render so there's no initial slide-in.
            ANIM_OUTER_W.store((natural_w as f32).to_bits(), Ordering::Relaxed);
        }
    }
    // DB render sets TARGET; fast loop owns motion via ANIM_OUTER_W — prevents snapping.
    let min_w = OUTER_PAD_L + label_w + GAP + inner_w + 4;
    let outer_w = outer_w_override
        .or_else(|| {
            let bits = ANIM_OUTER_W.load(Ordering::Relaxed);
            if bits != 0 { Some(f32::from_bits(bits) as u32) } else { None }
        })
        .map(|ow| ow.max(min_w))
        .unwrap_or(natural_w);

    let mut img: RgbaImage = ImageBuffer::from_pixel(outer_w, OUTER_H, Rgba([0, 0, 0, 0]));

    let outer_color = if distraction { [38, 18, 0, 255] } else { [14, 14, 18, 255] };
    fill_capsule(&mut img, 0, 0, outer_w, OUTER_H, outer_color);

    let label_color = if distraction { [255, 210, 100, 255] } else { [255, 255, 255, 255] };
    let label_baseline = text_baseline(&font, label_scale, OUTER_H);
    draw_text(&mut img, &font, label_scale, label, OUTER_PAD_L as f32, label_baseline, label_color);

    let badge_x = OUTER_PAD_L + label_w + GAP;
    let badge_y = INNER_MARGIN_V;
    let (_, fill_col, text_col) = if distraction {
        badge_colors_distraction()
    } else {
        badge_colors(category, is_idle)
    };

    // Deep-work categories: progress ring (grey track + green fill clockwise from top-center).
    if is_ring_cat && !distraction {
        fill_capsule(&mut img, badge_x, badge_y, inner_w, INNER_H, [50, 54, 58, 255]);
        if ring_progress > 0.005 {
            draw_capsule_border_progress(
                &mut img,
                badge_x, badge_y, inner_w, INNER_H,
                BADGE_BORDER,
                ring_progress.min(1.0),
                [55, 185, 55, 255],
            );
        }
    } else {
        let (border_col, _, _) = if distraction { badge_colors_distraction() } else { badge_colors(category, is_idle) };
        fill_capsule(&mut img, badge_x, badge_y, inner_w, INNER_H, border_col);
    }

    if inner_w > BADGE_BORDER * 2 && INNER_H > BADGE_BORDER * 2 {
        fill_capsule(&mut img, badge_x + BADGE_BORDER, badge_y + BADGE_BORDER,
            inner_w - BADGE_BORDER * 2, INNER_H - BADGE_BORDER * 2, fill_col);
    }

    let badge_baseline = text_baseline(&font, timer_scale, INNER_H) + badge_y as f32;
    let badge_text_x = badge_x as f32 + INNER_PAD_H as f32;
    draw_text(&mut img, &font, timer_scale, &badge_text, badge_text_x, badge_baseline, text_col);

    encode_png(img, outer_w, OUTER_H)
}

fn encode_png(img: RgbaImage, w: u32, h: u32) -> Option<Vec<u8>> {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_pixel_dims(Some(png::PixelDimensions {
            xppu: PNG_PPM, yppu: PNG_PPM, unit: png::Unit::Meter,
        }));
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&img.into_raw()).ok()?;
    }
    Some(buf)
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn text_baseline(font: &FontRef, scale: PxScale, container_h: u32) -> f32 {
    let s = font.as_scaled(scale);
    let line_h = s.ascent() - s.descent();
    let top = (container_h as f32 - line_h) / 2.0;
    top + s.ascent()
}

fn fill_capsule(img: &mut RgbaImage, ox: u32, oy: u32, w: u32, h: u32, color: [u8; 4]) {
    let fw = w as f32;
    let fh = h as f32;
    let r = fh / 2.0;

    for py in 0..h {
        for px in 0..w {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;

            let inside = if fx >= r && fx <= fw - r {
                true
            } else if fx < r {
                let dx = fx - r;
                let dy = fy - r;
                dx * dx + dy * dy <= r * r
            } else {
                let dx = fx - (fw - r);
                let dy = fy - r;
                dx * dx + dy * dy <= r * r
            };

            if inside {
                let ix = ox + px;
                let iy = oy + py;
                if ix < img.width() && iy < img.height() {
                    img.put_pixel(ix, iy, Rgba(color));
                }
            }
        }
    }
}

fn draw_capsule_border_progress(
    img: &mut RgbaImage,
    ox: u32, oy: u32, w: u32, h: u32,
    border: u32,
    progress: f32,
    color: [u8; 4],
) {
    let fw = w as f32;
    let fh = h as f32;
    let r = fh / 2.0; // end-cap radius

    // Perimeter clockwise from top-center: top-right straight → right arc → bottom → left arc → top-left straight.
    //  Segment C: bottom straight, (fw-r, fh) → (r, fh)       length = fw - 2r
    //  Segment D: left semicircle, PI/2 → 3*PI/2              length = PI*r
    //  Segment E: top straight back, (r, 0) → (fw/2, 0)       length = fw/2 - r
    let straight_len = (fw - 2.0 * r).max(0.0);
    let semi_len = std::f32::consts::PI * r;
    let total = 2.0 * straight_len + 2.0 * semi_len;
    let filled_len = progress * total;

    for py in 0..h {
        for px in 0..w {
            // Is this pixel inside the border annulus (inside outer capsule, outside inner capsule)?
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;

            let in_outer = point_in_capsule(fx, fy, fw, fh, 0.0);
            let b = border as f32;
            let in_inner = if fw > b * 2.0 && fh > b * 2.0 {
                point_in_capsule(fx - b, fy - b, fw - b * 2.0, fh - b * 2.0, 0.0)
            } else {
                false
            };

            if !in_outer || in_inner { continue; }

            let phase = capsule_perimeter_phase(fx, fy, fw, fh, r, straight_len, semi_len);

            if phase <= filled_len {
                let ix = ox + px;
                let iy = oy + py;
                if ix < img.width() && iy < img.height() {
                    img.put_pixel(ix, iy, Rgba(color));
                }
            }
        }
    }
}

fn point_in_capsule(fx: f32, fy: f32, fw: f32, fh: f32, _pad: f32) -> bool {
    let r = fh / 2.0;
    if fx >= r && fx <= fw - r {
        (fy - r).abs() <= r  // must also be within vertical bounds
    } else if fx < r {
        let dx = fx - r; let dy = fy - r;
        dx*dx + dy*dy <= r*r
    } else {
        let dx = fx - (fw - r); let dy = fy - r;
        dx*dx + dy*dy <= r*r
    }
}

fn capsule_perimeter_phase(fx: f32, fy: f32, fw: f32, fh: f32, r: f32, straight_len: f32, semi_len: f32) -> f32 {
    let cx_right = fw - r;
    let cx_left  = r;
    let cy       = r;

    if fx > fw - r {
        let dx = fx - cx_right;
        let dy = fy - cy;
        let mut angle = dy.atan2(dx);
        if angle < -std::f32::consts::FRAC_PI_2 {
            angle += std::f32::consts::TAU;
        }
        let offset = straight_len / 2.0;
        let arc = (angle + std::f32::consts::FRAC_PI_2) * r;
        return offset + arc;
    }

    if fx < cx_left {
        let dx = fx - cx_left;
        let dy = fy - cy;
        let mut angle = dy.atan2(dx);
        if angle < std::f32::consts::FRAC_PI_2 {
            angle += std::f32::consts::TAU;
        }
        let offset = straight_len / 2.0 + semi_len + straight_len;
        let arc = (angle - std::f32::consts::FRAC_PI_2) * r;
        return offset + arc;
    }

    if fy < fh / 2.0 {
        if fx >= fw / 2.0 {
            return fx - fw / 2.0;
        } else {
            let offset = straight_len / 2.0 + semi_len + straight_len + semi_len;
            return offset + (fx - cx_left);
        }
    }

    let offset = straight_len / 2.0 + semi_len;
    return offset + (cx_right - fx);
}

fn draw_text(
    img: &mut RgbaImage,
    font: &FontRef,
    scale: PxScale,
    text: &str,
    x: f32,
    baseline_y: f32,
    color: [u8; 4],
) {
    let scaled = font.as_scaled(scale);
    let mut pen_x = x;
    let mut prev: Option<GlyphId> = None;

    for ch in text.chars() {
        let gid = font.glyph_id(ch);
        if let Some(p) = prev {
            pen_x += scaled.kern(p, gid);
        }
        let glyph = gid.with_scale_and_position(scale, ab_glyph::point(pen_x, baseline_y));
        pen_x += scaled.h_advance(gid);
        prev = Some(gid);

        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, cov| {
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                if px >= 0 && py >= 0 && (px as u32) < img.width() && (py as u32) < img.height() {
                    let dst = img.get_pixel_mut(px as u32, py as u32);
                    let a = cov * (color[3] as f32 / 255.0);
                    dst[0] = (color[0] as f32 * cov + dst[0] as f32 * (1.0 - a)) as u8;
                    dst[1] = (color[1] as f32 * cov + dst[1] as f32 * (1.0 - a)) as u8;
                    dst[2] = (color[2] as f32 * cov + dst[2] as f32 * (1.0 - a)) as u8;
                    dst[3] = dst[3].saturating_add((a * 255.0) as u8);
                }
            });
        }
    }
}

fn measure_w(font: &FontRef, scale: PxScale, text: &str) -> u32 {
    let scaled = font.as_scaled(scale);
    let mut w = 0.0f32;
    let mut prev: Option<GlyphId> = None;
    for ch in text.chars() {
        let gid = font.glyph_id(ch);
        if let Some(p) = prev {
            w += scaled.kern(p, gid);
        }
        w += scaled.h_advance(gid);
        prev = Some(gid);
    }
    w.ceil() as u32
}

fn category_label(category: &str, is_idle: bool) -> &'static str {
    if is_idle {
        return "Idle";
    }
    match category {
        "development" => "Focus",
        "communication" => "Communication",
        "productivity" => "Productivity",
        "learning" => "Learning",
        "entertainment" => "Entertainment",
        "social" => "Social",
        "browser" => "Browsing",
        "system" => "System",
        _ => "Active",
    }
}

/// Capsule badge timer — used for non-focus categories.
fn format_timer(_category: &str, duration_seconds: u64, _is_idle: bool) -> String {
    if duration_seconds < 60 {
        let s = duration_seconds.max(1);
        if s == 1 { "1 second".to_string() } else { format!("{} seconds", s) }
    } else {
        let m = duration_seconds / 60;
        if m == 1 { "1 minute".to_string() } else { format!("{} minutes", m) }
    }
}


/// Badge colours: (border, fill, text)
/// Border is vivid/bright (visible ring like Blinkit's green), fill is near-black, text is white.
fn badge_colors(category: &str, is_idle: bool) -> ([u8; 4], [u8; 4], [u8; 4]) {
    if is_idle {
        return (
            [100, 100, 118, 255],  // gray border
            [18, 18, 24, 255],     // dark fill
            [210, 210, 225, 255],  // bright muted text
        );
    }
    match category {
        "development" => (
            [55, 185, 55, 255],    // vivid green border
            [8, 20, 8, 255],       // near-black green fill
            [255, 255, 255, 255],  // pure white text
        ),
        "entertainment" | "social" => (
            [215, 145, 20, 255],   // vivid amber border
            [22, 12, 0, 255],      // near-black amber fill
            [255, 235, 160, 255],  // bright warm text
        ),
        _ => (
            [90, 155, 220, 255],   // vivid blue border
            [8, 18, 32, 255],      // near-black blue fill
            [220, 240, 255, 255],  // bright cool white text
        ),
    }
}

fn badge_colors_distraction() -> ([u8; 4], [u8; 4], [u8; 4]) {
    (
        [240, 110, 20, 255],   // vivid orange border
        [30, 10, 0, 255],      // near-black fill
        [255, 215, 130, 255],  // bright warm orange text
    )
}

// ── tray menu snapshot ────────────────────────────────────────────────────────

fn build_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let snapshot = tray_snapshot(app);
    let status = MenuItem::new(app, snapshot.status_label(), false, None::<&str>)?;
    let active = MenuItem::new(
        app,
        format!("Active today: {}m", snapshot.active_minutes),
        false,
        None::<&str>,
    )?;
    let idle = MenuItem::new(
        app,
        format!("Idle today: {}m", snapshot.idle_minutes),
        false,
        None::<&str>,
    )?;
    let latest = MenuItem::new(
        app,
        format!("Now: {}", snapshot.latest_app),
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, MENU_SHOW, "Show Flint", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "Hide Flint", true, None::<&str>)?;
    let toggle = MenuItem::with_id(
        app,
        MENU_TOGGLE_TRACKING,
        if snapshot.private_mode_enabled {
            "Resume Flinting"
        } else {
            "Pause Flinting"
        },
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;
    let sep_c = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &status, &active, &idle, &latest, &sep_a, &show, &hide, &sep_b, &toggle, &sep_c,
            &quit,
        ],
    )
}

struct TraySnapshot {
    private_mode_enabled: bool,
    active_minutes: u64,
    idle_minutes: u64,
    latest_app: String,
}

impl TraySnapshot {
    fn status_label(&self) -> &'static str {
        if self.private_mode_enabled {
            "Flint: private mode"
        } else {
            "Actively Flinting"
        }
    }
}

fn tray_snapshot<R: Runtime>(app: &AppHandle<R>) -> TraySnapshot {
    let state = app.state::<AppState>();
    let Ok(database) = state.database.lock() else {
        return TraySnapshot::default();
    };
    let settings = SettingsRepository::new(database.connection())
        .get_privacy_settings()
        .ok();
    let events = AttentionEventRepository::new(database.connection())
        .list_recent(500)
        .unwrap_or_default();
    let active_seconds: u64 = events.iter().filter(|e| !e.is_idle).map(|e| e.duration_seconds).sum();
    let idle_seconds: u64 = events.iter().filter(|e| e.is_idle).map(|e| e.duration_seconds).sum();
    let latest_app = events
        .first()
        .map(|e| e.app_name.clone())
        .unwrap_or_else(|| "Waiting for data".to_string());

    TraySnapshot {
        private_mode_enabled: settings.map(|s| s.private_mode_enabled).unwrap_or(false),
        active_minutes: active_seconds / 60,
        idle_minutes: idle_seconds / 60,
        latest_app,
    }
}

impl Default for TraySnapshot {
    fn default() -> Self {
        Self {
            private_mode_enabled: false,
            active_minutes: 0,
            idle_minutes: 0,
            latest_app: "Unavailable".to_string(),
        }
    }
}
