use super::event::AttentionEvent;

pub fn calculate_focus_score(events: &[AttentionEvent], app_switches: usize) -> u8 {
    let active_seconds: u64 = events
        .iter()
        .filter(|event| !event.is_idle)
        .map(|event| event.duration_seconds)
        .sum();

    if active_seconds == 0 {
        return 0;
    }

    let focus_seconds: u64 = events
        .iter()
        .filter(|event| matches!(event.category.as_str(), "development" | "learning" | "productivity"))
        .map(|event| event.duration_seconds)
        .sum();

    let focus_ratio = focus_seconds as f32 / active_seconds as f32;
    let switch_penalty = (app_switches as f32 * 0.6).min(35.0);

    (focus_ratio.mul_add(100.0, -switch_penalty).max(0.0).round()) as u8
}
