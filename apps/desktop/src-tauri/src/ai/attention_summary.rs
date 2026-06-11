use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionSummaryResult {
    pub summary: String,
    pub what_was_off: String,
    #[serde(default)]
    pub time_wasters: Vec<String>,
    #[serde(default)]
    pub main_distractions: Vec<String>,
    pub tip: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingConfig>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ThinkingConfig {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<AnthropicMessage>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContent {
    #[serde(rename = "type")]
    kind: String,
    text: String,
}

pub fn summarize_attention_with_ai(
    base_url: &str,
    model: &str,
    api_key: &str,
    scope: &str,
    compact_event_report: &str,
) -> Result<AttentionSummaryResult, String> {
    if base_url.contains("anthropic") {
        return summarize_anthropic(base_url, model, api_key, scope, compact_event_report);
    }
    summarize_openai(base_url, model, api_key, scope, compact_event_report)
}

fn summarize_openai(
    base_url: &str,
    model: &str,
    api_key: &str,
    scope: &str,
    compact_event_report: &str,
) -> Result<AttentionSummaryResult, String> {
    let endpoint = format!("{}/chat/completions", base_url.trim().trim_end_matches('/'));
    let request = ChatCompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage { role: "system".to_string(), content: system_prompt() },
            ChatMessage {
                role: "user".to_string(),
                content: format!("Scope: {scope}\n\n{compact_event_report}"),
            },
        ],
        max_tokens: if base_url.contains("openai.com") { None } else { Some(420) },
        max_completion_tokens: if base_url.contains("openai.com") { Some(420) } else { None },
        temperature: 0.2,
        thinking: if base_url.contains("deepseek") {
            Some(ThinkingConfig { kind: "disabled".to_string() })
        } else {
            None
        },
    };

    let response = build_client(Duration::from_secs(12))?
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .map_err(network_error)?;

    let text = check_status(response)?;
    let completion = serde_json::from_str::<ChatCompletionResponse>(&text)
        .map_err(|e| format!("Unable to parse AI summary response: {e}"))?;
    let content = completion
        .choices
        .first()
        .map(|c| c.message.content.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "AI response did not include a summary".to_string())?;

    parse_summary(content)
}

fn summarize_anthropic(
    base_url: &str,
    model: &str,
    api_key: &str,
    scope: &str,
    compact_event_report: &str,
) -> Result<AttentionSummaryResult, String> {
    let endpoint = format!("{}/v1/messages", base_url.trim().trim_end_matches('/'));
    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: 420,
        system: system_prompt(),
        messages: vec![AnthropicMessage {
            role: "user".to_string(),
            content: format!("Scope: {scope}\n\n{compact_event_report}"),
        }],
    };

    let response = build_client(Duration::from_secs(12))?
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&request)
        .send()
        .map_err(network_error)?;

    let text = check_status(response)?;
    let completion = serde_json::from_str::<AnthropicResponse>(&text)
        .map_err(|e| format!("Unable to parse Anthropic response: {e}"))?;
    let content = completion
        .content
        .iter()
        .find(|c| c.kind == "text")
        .map(|c| c.text.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Anthropic response contained no text".to_string())?;

    parse_summary(content)
}

fn parse_summary(content: &str) -> Result<AttentionSummaryResult, String> {
    let json = extract_json(content)
        .ok_or_else(|| format!("No JSON object found in AI response: {}", truncate(content, 120)))?;
    serde_json::from_str::<AttentionSummaryResult>(json)
        .map_err(|e| format!("Unable to parse AI summary JSON: {e}"))
}

fn extract_json(text: &str) -> Option<&str> {
    if serde_json::from_str::<serde_json::Value>(text.trim()).is_ok() {
        return Some(text.trim());
    }
    let stripped = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if serde_json::from_str::<serde_json::Value>(stripped).is_ok() {
        return Some(stripped);
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end > start {
        let candidate = &text[start..=end];
        if serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
            return Some(candidate);
        }
    }
    None
}

fn build_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Unable to create AI client: {e}"))
}

fn network_error(error: reqwest::Error) -> String {
    let msg = error.to_string();
    if msg.contains("dns") || msg.contains("connect") || msg.contains("timeout") {
        "Could not reach endpoint — check the base URL".to_string()
    } else {
        format!("Request failed: {error}")
    }
}

fn check_status(response: reqwest::blocking::Response) -> Result<String, String> {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if status.is_success() {
        Ok(body)
    } else {
        Err(friendly_api_error(status.as_u16(), &body))
    }
}

fn friendly_api_error(status: u16, body: &str) -> String {
    match status {
        401 | 403 => "Invalid API key — check your credentials".to_string(),
        404 => "Endpoint not found — check the base URL".to_string(),
        429 => "Rate limit reached — try again later".to_string(),
        400 => {
            let hint = extract_error_message(body);
            format!("Bad request — {}", hint.unwrap_or_else(|| "check model name and parameters".to_string()))
        }
        422 => {
            let hint = extract_error_message(body);
            format!("Invalid request — {}", hint.unwrap_or_else(|| "check model name".to_string()))
        }
        500..=599 => format!("Server error ({status}) — try again later"),
        _ => {
            let hint = extract_error_message(body);
            format!("API error {status}{}", hint.map(|h| format!(": {h}")).unwrap_or_default())
        }
    }
}

fn extract_error_message(body: &str) -> Option<String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = value.pointer("/error/message").and_then(|v| v.as_str()) {
            return Some(truncate(msg, 120));
        }
        if let Some(msg) = value.get("message").and_then(|v| v.as_str()) {
            return Some(truncate(msg, 120));
        }
    }
    None
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

fn system_prompt() -> String {
    r#"You will receive a complete chronological attention trail containing every app switch the user made during a session. Each event includes timestamp, duration, category, app name, and window title.

Your job is to reconstruct how attention moved through the session: where focus held, where it fractured, what triggered switches, how quickly the user recovered, and how stable attention remained over time.

Read the trail like an attention analyst reconstructing cognitive flow from observable behavior. Focus on patterns visible in the data. Do not speculate about emotions, personality, motivation, stress, boredom, procrastination, or intent unless strongly supported by switching behavior.

Treat coding, writing, design, documentation, research, learning, development tools, IDEs, note-taking apps, and educational content as productive focus unless the trail clearly suggests otherwise.

Events with category "system" are operating system processes or monitoring tools (e.g. Flint, Finder, System Preferences) — they are not user work. Exclude them entirely from analysis. Never mention them in any field, never list them as time wasters or distractions.

Return exactly one JSON object with the following keys:

{"summary": string, "what_was_off": string, "time_wasters": string[], "main_distractions": string[], "tip": string}

Field requirements:

"summary": 40-70 words. Warm, honest, conversational tone. Mention the primary tool, task, or focus area. Estimate roughly how long sustained focus lasted. Include one meaningful observation about the rhythm, depth, recovery, or stability of attention. Sound like a trusted friend reflecting on the session, not a report generator.

"what_was_off": 1-2 sentences. If attention drift occurred, identify the specific trigger using the real app name or exact window title from the trail. Explain the likely attention pattern using concepts such as novelty pull, context-switch cost, exploration loops, fragmented attention, or decision fatigue. If focus remained strong throughout, explain which observable pattern supported that conclusion. Base conclusions only on evidence visible in the trail.

"time_wasters": Array of 1-3 strings. Use exact app names or window titles from the trail. Pick the apps or sites that consumed the most time away from the primary task, or caused the most repeated context switches. If the session was entirely focused with zero drift, return the single app or site where attention lingered least productively. Never return an empty array.

"main_distractions": Array of 1-2 strings. Use exact app names or window titles from the trail. Pick the strongest attention-breaking sources — the things that pulled the user away most sharply or most often. If focus was strong, return the one thing that came closest to breaking it. Never return an empty array.

"tip": Exactly one sentence. Calm, practical, and specific. Must reference an actual pattern, app, window title, or switching behavior observed in the trail. Avoid generic advice such as "stay focused", "reduce distractions", or "avoid multitasking".

Additional rules: Always use real names from the trail. When a window title clearly reveals the trigger of a switch, prefer the exact window title over the app name. If the session demonstrates strong focus, acknowledge it rather than searching for problems. If the trail is short, sparse, or ambiguous, reduce certainty and describe observations cautiously. Never moralize. Never shame the user. Never use the word "optimal". Never invent activities that do not appear in the trail. Never refer to something as "the app", "a website", or "an entertainment site" when a real name is available. Learning, research, and development activities should be treated as valuable focus unless evidence suggests otherwise. Output only the JSON object and nothing else."#.to_string()
}
