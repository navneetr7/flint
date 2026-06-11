use super::{active_app::ActiveApp, platform::ActiveAppProvider};
use objc2_app_kit::NSWorkspace;
use serde::Serialize;
use std::process::Command;

pub struct MacOsActiveAppProvider;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserDiagnostic {
    pub supported_browser: bool,
    pub browser_name: Option<String>,
    /// Stable token: "ready" | "automation_denied" | "not_running" | "no_window" | "no_url" | "not_browser" | "script_error"
    pub status: String,
    pub detail: String,
    pub remediation: String,
}

impl ActiveAppProvider for MacOsActiveAppProvider {
    fn current_app(&self) -> Option<ActiveApp> {
        let name = frontmost_app_name()?;

        if name.is_empty() {
            return None;
        }

        Some(ActiveApp {
            name,
            window_title: None,
        })
    }

    fn enrich_context(&self, active_app: ActiveApp) -> ActiveApp {
        match active_app.name.as_str() {
            "Google Chrome" | "Chrome" => {
                browser_context(active_app, BrowserKind::Chrome, "Google Chrome")
            }
            "Arc" => browser_context(active_app, BrowserKind::Arc, "Arc"),
            "Comet" => browser_context(active_app, BrowserKind::Comet, "Comet"),
            "Atlas" | "OpenAI Atlas" => browser_context(active_app, BrowserKind::Atlas, "Atlas"),
            "Safari" => browser_context(active_app, BrowserKind::Safari, "Safari"),
            "Firefox" => browser_context(active_app, BrowserKind::Firefox, "Firefox"),
            "Terminal" | "iTerm2" => terminal_context(active_app),
            _ => active_app,
        }
    }
}

fn frontmost_app_name() -> Option<String> {
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let name = app.localizedName()?.to_string();

    Some(name.trim().to_string())
}

enum BrowserKind {
    Chrome,
    Arc,
    Comet,
    Atlas,
    Safari,
    Firefox,
}

pub fn browser_diagnostic_for_app(app_name: &str) -> BrowserDiagnostic {
    let Some((browser, browser_name)) = browser_kind_for_app(app_name) else {
        return BrowserDiagnostic {
            supported_browser: false,
            browser_name: None,
            status: "not_browser".to_string(),
            detail: "Not a supported browser.".to_string(),
            remediation: String::new(),
        };
    };

    match active_browser_tab_result(browser) {
        Ok((title, url)) if url_domain(&url).is_some() => BrowserDiagnostic {
            supported_browser: true,
            browser_name: Some(browser_name.to_string()),
            status: "ready".to_string(),
            detail: format!("Active tab captured: {}", compact_title(&title)),
            remediation: String::new(),
        },
        Ok((_title, url)) => BrowserDiagnostic {
            supported_browser: true,
            browser_name: Some(browser_name.to_string()),
            status: "no_url".to_string(),
            detail: format!("Tab URL has no web domain: {}", compact_title(&url)),
            remediation: "Navigate to a regular website and check again.".to_string(),
        },
        Err(token) => diagnostic_from_error_token(browser_name, &token),
    }
}

fn diagnostic_from_error_token(browser_name: &str, token: &str) -> BrowserDiagnostic {
    let (status, detail, remediation) = if token == "automation_denied" {
        (
            "automation_denied",
            format!("macOS blocked Flint from reading the active {browser_name} tab."),
            format!(
                "In {browser_name}: Developer menu → Allow JavaScript from Apple Events. \
                 Then open System Settings → Privacy & Security → Automation and enable \
                 Flint → {browser_name}."
            ),
        )
    } else if token == "not_running" {
        (
            "not_running",
            format!("{browser_name} is not running."),
            format!("Open {browser_name} and navigate to a website, then check again."),
        )
    } else if token == "no_window" {
        (
            "no_window",
            format!("No {browser_name} window or tab is open."),
            format!("Open a tab in {browser_name} and check again."),
        )
    } else {
        (
            "script_error",
            format!("Browser automation error ({token})."),
            "Try enabling 'Allow JavaScript from Apple Events' in the browser's Developer menu."
                .to_string(),
        )
    };

    BrowserDiagnostic {
        supported_browser: true,
        browser_name: Some(browser_name.to_string()),
        status: status.to_string(),
        detail,
        remediation,
    }
}

/// Opens a macOS System Settings URL (no-op on other platforms).
pub fn open_system_settings(url: &str) {
    let _ = Command::new("open").arg(url).spawn();
}

fn browser_context(active_app: ActiveApp, browser: BrowserKind, browser_name: &str) -> ActiveApp {
    let Some((title, url)) = active_browser_tab(browser) else {
        return active_app;
    };
    let Some(domain) = url_domain(&url) else {
        return ActiveApp {
            window_title: clean_optional(title),
            ..active_app
        };
    };

    ActiveApp {
        name: format!("{browser_name}: {domain}"),
        window_title: clean_browser_title(title, &domain),
    }
}

fn terminal_context(active_app: ActiveApp) -> ActiveApp {
    let tty = match active_app.name.as_str() {
        "Terminal" => terminal_tty(),
        "iTerm2" => iterm_tty(),
        _ => None,
    };
    let Some(tty) = tty else {
        return active_app;
    };
    let Some(process_name) = foreground_process_for_tty(&tty) else {
        return active_app;
    };

    let label = terminal_process_label(&process_name);

    // Standalone CLI dev tools are surfaced as first-class apps — no terminal
    // prefix — so they are distinguishable from same-named desktop apps and
    // classified correctly by the rule engine ("claude code", "codex cli", …).
    let name = if is_standalone_cli_tool(&process_name) {
        label.to_string()
    } else {
        format!("{}: {}", active_app.name, label)
    };

    ActiveApp {
        name,
        window_title: Some(format!("terminal process: {}", process_name)),
    }
}

/// CLI tools that should appear as their own top-level entry rather than
/// "Terminal: <tool>" so they are not confused with desktop apps of the same name.
fn is_standalone_cli_tool(process_name: &str) -> bool {
    matches!(process_name, "claude" | "codex")
}

fn active_browser_tab(browser: BrowserKind) -> Option<(String, String)> {
    active_browser_tab_result(browser).ok()
}

fn active_browser_tab_result(browser: BrowserKind) -> Result<(String, String), String> {
    match browser {
        BrowserKind::Chrome => chromium_active_tab("Google Chrome"),
        BrowserKind::Arc => chromium_active_tab("Arc"),
        BrowserKind::Comet => chromium_active_tab("Comet"),
        BrowserKind::Atlas => {
            chromium_active_tab("OpenAI Atlas").or_else(|_| chromium_active_tab("Atlas"))
        }
        BrowserKind::Safari => safari_active_tab(),
        BrowserKind::Firefox => chromium_active_tab("Firefox"),
    }
}

fn chromium_active_tab(application_name: &str) -> Result<(String, String), String> {
    let title = run_osascript(&format!(
        r#"tell application "{application_name}" to get title of active tab of front window"#
    ))?;
    let url = run_osascript(&format!(
        r#"tell application "{application_name}" to get URL of active tab of front window"#
    ))?;

    Ok((title, url))
}

fn safari_active_tab() -> Result<(String, String), String> {
    let title =
        run_osascript(r#"tell application "Safari" to get name of current tab of front window"#)?;
    let url =
        run_osascript(r#"tell application "Safari" to get URL of current tab of front window"#)?;

    Ok((title, url))
}

fn terminal_tty() -> Option<String> {
    run_osascript(r#"tell application "Terminal" to get tty of selected tab of front window"#)
        .ok()
        .and_then(normalize_tty)
}

fn iterm_tty() -> Option<String> {
    run_osascript(r#"tell application "iTerm2" to get tty of current session of current window"#)
        .ok()
        .and_then(normalize_tty)
}

fn foreground_process_for_tty(tty: &str) -> Option<String> {
    let output = Command::new("ps")
        .args(["-t", tty, "-o", "pid=", "-o", "comm="])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .filter_map(parse_process_name)
        .filter(|name| !is_shell_process(name))
        .last()
}

fn parse_process_name(line: &str) -> Option<String> {
    let process_path = line.split_whitespace().nth(1)?;
    let process_name = process_path.rsplit('/').next()?.trim();

    if process_name.is_empty() {
        return None;
    }

    Some(process_name.to_string())
}

fn run_osascript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| format!("Unable to run osascript: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(classify_osascript_error(&stderr));
    }

    let value = String::from_utf8(output.stdout)
        .map_err(|error| format!("Invalid osascript output: {error}"))?
        .trim()
        .to_string();

    if value.is_empty() {
        return Err("automation_denied".to_string());
    }

    Ok(value)
}

/// Translates raw osascript stderr into a stable error token that the frontend can match on.
fn classify_osascript_error(stderr: &str) -> String {
    // -1743 / "Not authorized": Automation permission not granted
    if stderr.contains("-1743") || stderr.contains("Not authorized") || stderr.contains("not authorized") {
        return "automation_denied".to_string();
    }
    // -10004: user authorization required (another Automation denial variant)
    if stderr.contains("-10004") || stderr.contains("authorization required") {
        return "automation_denied".to_string();
    }
    // -600 / "Application is not running"
    if stderr.contains("-600")
        || stderr.contains("Application is not running")
        || stderr.contains("isn't running")
        || stderr.contains("is not running")
    {
        return "not_running".to_string();
    }
    // -1728: Can't get object (no window / no tab)
    if stderr.contains("-1728") || stderr.contains("Can't get") || stderr.contains("can't get") {
        return "no_window".to_string();
    }
    // Generic fallback — include the raw stderr so the developer can see it
    if stderr.is_empty() {
        "automation_denied".to_string()
    } else {
        format!("script_error: {stderr}")
    }
}

fn url_domain(url: &str) -> Option<String> {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host = without_scheme
        .split(['/', '?', '#'])
        .next()?
        .trim()
        .trim_start_matches("www.")
        .to_lowercase();

    if host.is_empty() {
        return None;
    }

    Some(host)
}

fn normalize_tty(value: String) -> Option<String> {
    let tty = value.trim().trim_start_matches("/dev/").to_string();

    if tty.is_empty() {
        return None;
    }

    Some(tty)
}

fn clean_optional(value: String) -> Option<String> {
    let value = value.trim().to_string();

    if value.is_empty() {
        return None;
    }

    Some(value)
}

fn clean_browser_title(title: String, site_name: &str) -> Option<String> {
    let mut title = title.trim().to_string();

    if site_name == "YouTube" || site_name == "youtube.com" || site_name == "youtu.be" {
        title = title
            .strip_suffix(" - YouTube")
            .unwrap_or(&title)
            .trim()
            .to_string();
    }

    clean_optional(title)
}

fn is_shell_process(process_name: &str) -> bool {
    matches!(
        process_name,
        // Shells
        "bash" | "zsh" | "fish" | "sh" | "login" | "tmux" | "screen"
        // Background utilities spawned by dev tools (e.g. caffeinate is launched by Claude Code
        // to prevent sleep — it appears after the parent in ps output and would mask it)
        | "caffeinate"
    )
}

fn terminal_process_label(process_name: &str) -> &str {
    match process_name {
        "codex" => "Codex CLI",
        "claude" => "Claude Code",
        "nvim" => "Neovim",
        "vim" => "Vim",
        "node" => "Node.js",
        "npm" => "npm",
        "pnpm" => "pnpm",
        "yarn" => "Yarn",
        "cargo" => "Cargo",
        "rustc" => "Rust",
        "python" | "python3" => "Python",
        "go" => "Go",
        "git" => "Git",
        "ssh" => "SSH",
        _ => process_name,
    }
}

fn browser_kind_for_app(app_name: &str) -> Option<(BrowserKind, &'static str)> {
    match app_name {
        "Google Chrome" | "Chrome" => Some((BrowserKind::Chrome, "Google Chrome")),
        "Arc" => Some((BrowserKind::Arc, "Arc")),
        "Comet" => Some((BrowserKind::Comet, "Comet")),
        "Atlas" | "OpenAI Atlas" => Some((BrowserKind::Atlas, "Atlas")),
        "Safari" => Some((BrowserKind::Safari, "Safari")),
        "Firefox" => Some((BrowserKind::Firefox, "Firefox")),
        _ => None,
    }
}

fn compact_title(value: &str) -> String {
    const MAX_LENGTH: usize = 80;
    let value = value.trim();

    if value.chars().count() <= MAX_LENGTH {
        return value.to_string();
    }

    format!("{}...", value.chars().take(MAX_LENGTH).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::clean_browser_title;

    #[test]
    fn removes_youtube_suffix_from_video_titles() {
        assert_eq!(
            clean_browser_title(
                "Tauri Rust SQLite tutorial - YouTube".to_string(),
                "YouTube"
            ),
            Some("Tauri Rust SQLite tutorial".to_string())
        );
    }

    #[test]
    fn preserves_non_youtube_titles() {
        assert_eq!(
            clean_browser_title("Dashboard - Linear".to_string(), "Linear"),
            Some("Dashboard - Linear".to_string())
        );
    }
}
