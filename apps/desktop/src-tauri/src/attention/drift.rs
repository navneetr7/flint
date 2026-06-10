use super::event::AttentionEvent;

pub fn count_app_switches(events: &[AttentionEvent]) -> usize {
    events
        .windows(2)
        .filter(|pair| pair[0].app_name != pair[1].app_name)
        .count()
}
