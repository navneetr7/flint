use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionEvent {
    pub id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub category: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: u64,
    pub is_idle: bool,
}
