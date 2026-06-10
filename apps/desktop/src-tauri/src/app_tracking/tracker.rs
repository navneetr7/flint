use rusqlite::Result;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use uuid::Uuid;

use super::platform::ActiveAppProvider;
use crate::{
    attention::event::AttentionEvent,
    database::repositories::{
        attention_events::AttentionEventRepository, classification::ClassificationRepository,
        settings::SettingsRepository,
    },
    idle::platform::IdleProvider,
};

pub struct AttentionTracker<TActiveAppProvider, TIdleProvider> {
    active_app_provider: TActiveAppProvider,
    idle_provider: TIdleProvider,
}

impl<TActiveAppProvider, TIdleProvider> AttentionTracker<TActiveAppProvider, TIdleProvider>
where
    TActiveAppProvider: ActiveAppProvider,
    TIdleProvider: IdleProvider,
{
    pub fn new(active_app_provider: TActiveAppProvider, idle_provider: TIdleProvider) -> Self {
        Self {
            active_app_provider,
            idle_provider,
        }
    }

    pub fn record_sample(
        &self,
        attention_events: &AttentionEventRepository,
        settings: &SettingsRepository,
        duration_seconds: u64,
    ) -> Result<Option<AttentionEvent>> {
        let privacy_settings = settings.get_privacy_settings()?;

        if privacy_settings.private_mode_enabled {
            return Ok(None);
        }

        let idle_state = self.idle_provider.idle_state();
        if idle_state.idle_seconds >= privacy_settings.idle_threshold_seconds {
            return self.record_idle_sample(attention_events, duration_seconds);
        }

        let Some(active_app) = self.active_app_provider.current_app() else {
            return Ok(None);
        };
        let active_app = if privacy_settings.collect_window_titles {
            self.active_app_provider.enrich_context(active_app)
        } else {
            active_app
        };

        if privacy_settings
            .excluded_apps
            .iter()
            .any(|app| app.eq_ignore_ascii_case(&active_app.name))
        {
            return Ok(None);
        }

        let classification = ClassificationRepository::new(attention_events.connection())
            .classify_app_reading_cache(&active_app.name, &active_app.window_title)?;
        let app_name = classification.display_name;
        let ended_at = OffsetDateTime::now_utc();
        let started_at = ended_at - Duration::seconds(duration_seconds as i64);
        let ended_at_value = format_time(ended_at);
        let started_at_value = format_time(started_at);
        let category = classification.category;
        let window_title = active_app.window_title;

        if let Some(mut latest_event) = attention_events.latest()? {
            if can_extend_session(&latest_event, &app_name, &category, &window_title) {
                latest_event.ended_at = ended_at_value;
                latest_event.duration_seconds += duration_seconds;
                attention_events.extend(&latest_event)?;

                return Ok(Some(latest_event));
            }
        }

        let event = AttentionEvent {
            id: Uuid::new_v4().to_string(),
            app_name: app_name.clone(),
            window_title,
            category,
            started_at: started_at_value,
            ended_at: ended_at_value,
            duration_seconds,
            is_idle: false,
        };

        attention_events.insert(&event)?;

        Ok(Some(event))
    }

    fn record_idle_sample(
        &self,
        attention_events: &AttentionEventRepository,
        duration_seconds: u64,
    ) -> Result<Option<AttentionEvent>> {
        let ended_at = OffsetDateTime::now_utc();
        let started_at = ended_at - Duration::seconds(duration_seconds as i64);
        let ended_at_value = format_time(ended_at);
        let started_at_value = format_time(started_at);

        if let Some(mut latest_event) = attention_events.latest()? {
            if latest_event.is_idle {
                latest_event.ended_at = ended_at_value;
                latest_event.duration_seconds += duration_seconds;
                attention_events.extend(&latest_event)?;

                return Ok(Some(latest_event));
            }
        }

        let event = AttentionEvent {
            id: Uuid::new_v4().to_string(),
            app_name: "Idle".to_string(),
            window_title: None,
            category: "system".to_string(),
            started_at: started_at_value,
            ended_at: ended_at_value,
            duration_seconds,
            is_idle: true,
        };

        attention_events.insert(&event)?;

        Ok(Some(event))
    }
}

fn can_extend_session(
    event: &AttentionEvent,
    app_name: &str,
    category: &str,
    window_title: &Option<String>,
) -> bool {
    !event.is_idle
        && event.app_name == app_name
        && event.category == category
        && event.window_title == *window_title
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}
