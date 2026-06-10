use super::event::AttentionEvent;

pub fn merge_adjacent_sessions(events: &[AttentionEvent]) -> Vec<AttentionEvent> {
    let mut sessions: Vec<AttentionEvent> = Vec::new();

    for event in events {
        if let Some(previous) = sessions.last_mut() {
            if previous.app_name == event.app_name && previous.is_idle == event.is_idle {
                previous.ended_at = event.ended_at.clone();
                previous.duration_seconds += event.duration_seconds;
                continue;
            }
        }

        sessions.push(event.clone());
    }

    sessions
}
