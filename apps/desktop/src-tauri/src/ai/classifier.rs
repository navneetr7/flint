use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct AiClassificationResult {
    pub display_name: String,
    pub category: String,
}

// ── OpenAI-compatible structs ─────────────────────────────────────────────────

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

// ── Anthropic-native structs ──────────────────────────────────────────────────

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

// ── Shared ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ClassificationPayload {
    display_name: String,
    category: String,
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Async (non-blocking) version — use this from Tauri async tasks so no OS
/// thread is parked waiting on the HTTP response.
pub async fn classify_with_ai_async(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    api_key: &str,
    app_name: &str,
    host: Option<&str>,
    title: Option<&str>,
    timeout: std::time::Duration,
) -> Result<AiClassificationResult, String> {
    if base_url.contains("anthropic") {
        return classify_anthropic_async(client, base_url, model, api_key, app_name, host, title, timeout)
            .await;
    }
    classify_openai_async(client, base_url, model, api_key, app_name, host, title, timeout).await
}

pub fn classify_with_ai(
    base_url: &str,
    model: &str,
    api_key: &str,
    app_name: &str,
    host: Option<&str>,
    title: Option<&str>,
    timeout: std::time::Duration,
) -> Result<AiClassificationResult, String> {
    if base_url.contains("anthropic") {
        return classify_anthropic(base_url, model, api_key, app_name, host, title, timeout);
    }
    classify_openai(base_url, model, api_key, app_name, host, title, timeout)
}

// ── OpenAI-compatible path ────────────────────────────────────────────────────

fn classify_openai(
    base_url: &str,
    model: &str,
    api_key: &str,
    app_name: &str,
    host: Option<&str>,
    title: Option<&str>,
    timeout: std::time::Duration,
) -> Result<AiClassificationResult, String> {
    let endpoint = format!("{}/chat/completions", base_url.trim().trim_end_matches('/'));
    let request = ChatCompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage { role: "system".to_string(), content: system_prompt().to_string() },
            ChatMessage { role: "user".to_string(), content: user_prompt(app_name, host, title) },
        ],
        max_tokens: if base_url.contains("openai.com") { None } else { Some(80) },
        max_completion_tokens: if base_url.contains("openai.com") { Some(80) } else { None },
        temperature: 0.0,
        thinking: if base_url.contains("deepseek") {
            Some(ThinkingConfig { kind: "disabled".to_string() })
        } else {
            None
        },
    };

    let response = build_client(timeout)?
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .map_err(network_error)?;

    let text = check_status(response)?;
    let completion = serde_json::from_str::<ChatCompletionResponse>(&text)
        .map_err(|e| format!("Unable to parse AI response: {e}"))?;
    let content = completion
        .choices
        .first()
        .map(|c| c.message.content.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "AI response did not include a classification".to_string())?;

    parse_payload(content)
}

// ── Anthropic native path ─────────────────────────────────────────────────────

fn classify_anthropic(
    base_url: &str,
    model: &str,
    api_key: &str,
    app_name: &str,
    host: Option<&str>,
    title: Option<&str>,
    timeout: std::time::Duration,
) -> Result<AiClassificationResult, String> {
    let endpoint = format!("{}/v1/messages", base_url.trim().trim_end_matches('/'));
    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: 80,
        system: system_prompt().to_string(),
        messages: vec![AnthropicMessage {
            role: "user".to_string(),
            content: user_prompt(app_name, host, title),
        }],
    };

    let response = build_client(timeout)?
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

    parse_payload(content)
}

// ── Async implementations ─────────────────────────────────────────────────────

async fn classify_openai_async(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    api_key: &str,
    app_name: &str,
    host: Option<&str>,
    title: Option<&str>,
    timeout: std::time::Duration,
) -> Result<AiClassificationResult, String> {
    let endpoint = format!("{}/chat/completions", base_url.trim().trim_end_matches('/'));
    let request = ChatCompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage { role: "system".to_string(), content: system_prompt().to_string() },
            ChatMessage { role: "user".to_string(), content: user_prompt(app_name, host, title) },
        ],
        max_tokens: if base_url.contains("openai.com") { None } else { Some(80) },
        max_completion_tokens: if base_url.contains("openai.com") { Some(80) } else { None },
        temperature: 0.0,
        thinking: if base_url.contains("deepseek") {
            Some(ThinkingConfig { kind: "disabled".to_string() })
        } else {
            None
        },
    };

    let response = client
        .post(endpoint)
        .timeout(timeout)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|e| network_error_str(&e.to_string()))?;

    let text = check_status_async(response).await?;
    let completion = serde_json::from_str::<ChatCompletionResponse>(&text)
        .map_err(|e| format!("Unable to parse AI response: {e}"))?;
    let content = completion
        .choices
        .first()
        .map(|c| c.message.content.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "AI response did not include a classification".to_string())?;

    parse_payload(content)
}

async fn classify_anthropic_async(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    api_key: &str,
    app_name: &str,
    host: Option<&str>,
    title: Option<&str>,
    timeout: std::time::Duration,
) -> Result<AiClassificationResult, String> {
    let endpoint = format!("{}/v1/messages", base_url.trim().trim_end_matches('/'));
    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: 80,
        system: system_prompt().to_string(),
        messages: vec![AnthropicMessage {
            role: "user".to_string(),
            content: user_prompt(app_name, host, title),
        }],
    };

    let response = client
        .post(endpoint)
        .timeout(timeout)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&request)
        .send()
        .await
        .map_err(|e| network_error_str(&e.to_string()))?;

    let text = check_status_async(response).await?;
    let completion = serde_json::from_str::<AnthropicResponse>(&text)
        .map_err(|e| format!("Unable to parse Anthropic response: {e}"))?;
    let content = completion
        .content
        .iter()
        .find(|c| c.kind == "text")
        .map(|c| c.text.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Anthropic response contained no text".to_string())?;

    parse_payload(content)
}

async fn check_status_async(response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status.is_success() {
        Ok(body)
    } else {
        Err(friendly_api_error(status.as_u16(), &body))
    }
}

fn network_error_str(msg: &str) -> String {
    if msg.contains("dns") || msg.contains("connect") || msg.contains("timeout") {
        "Could not reach endpoint — check the base URL".to_string()
    } else {
        format!("Request failed: {msg}")
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

fn parse_payload(content: &str) -> Result<AiClassificationResult, String> {
    let json = extract_json(content)
        .ok_or_else(|| format!("No JSON object found in AI response: {}", truncate(content, 120)))?;
    let payload = serde_json::from_str::<ClassificationPayload>(json)
        .map_err(|e| format!("Unable to parse AI classification JSON: {e}"))?;
    Ok(AiClassificationResult {
        display_name: payload.display_name,
        category: payload.category,
    })
}

// Extracts the first {...} block from a response that may be wrapped in markdown fences.
fn extract_json(text: &str) -> Option<&str> {
    // Try the whole string first (fast path for well-behaved models)
    if serde_json::from_str::<serde_json::Value>(text.trim()).is_ok() {
        return Some(text.trim());
    }
    // Strip ```json ... ``` or ``` ... ``` fences
    let stripped = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if serde_json::from_str::<serde_json::Value>(stripped).is_ok() {
        return Some(stripped);
    }
    // Find first { ... } span
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

fn system_prompt() -> &'static str {
    r#"You classify computer attention events for a focus analytics app.

Classify the user's most likely purpose — not the content type or format.

Return exactly one JSON object:
{"display_name":"<clean name>","category":"<category>"}

No explanations. JSON only.

Categories:
development, communication, learning, productivity, browser, entertainment, social, system, unknown

development   — writing, reviewing, debugging, or deploying software; IDEs, terminals, Git, cloud tools, API docs used while building
communication — email, chat, meetings, calls
learning      — intentional acquisition of knowledge or skills: courses, tutorials, how-to guides, technical docs, lectures
productivity  — planning, designing, writing, note-taking, project tracking
entertainment — leisure content: music, videos, shows, movies, gaming, sports, podcasts, pop culture, fandom
social        — feeds, profiles, posting, communities
system        — OS settings, file managers, installers, system utilities
browser       — generic web usage where intent cannot be reasonably inferred from the available signals; use only as a last resort
unknown       — insufficient signal

Rules:
- The user's likely intent matters more than the app or website.
- Window/page title is the strongest signal.
- Prefer specific categories over browser.
- Prefer development over learning when the user is actively building software.
- Fictional, celebrity, gaming, sports, music, movie, TV, or pop-culture content → entertainment, even if presented analytically.
- Use learning only when the primary goal is acquiring applicable knowledge; an explanatory or analytical title alone is not enough.

Examples:
"React Hooks Explained" → learning
"Kubernetes Networking Deep Dive" → learning
"Fix login bug - VS Code" → development
"Ramin Djawadi - The Rains Of Castamere" → entertainment
"The Science of Iron Man's Suit" → entertainment
"Why Interstellar's Black Hole Looks Real" → entertainment
"Every Marvel Easter Egg Explained" → entertainment
"Premier League Highlights" → entertainment
"Instagram Home Feed" → social
"Notion - Sprint Planning" → productivity"#
}

fn user_prompt(app_name: &str, host: Option<&str>, title: Option<&str>) -> String {
    format!(
        "App: {}\nWebsite host: {}\nWindow or page title: {}\nClassify this attention event.",
        app_name.trim(),
        host.unwrap_or("none"),
        title.unwrap_or("none")
    )
}
