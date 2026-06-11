pub fn is_focus_category(category: &str) -> bool {
    matches!(
        category,
        "development" | "productivity" | "learning" | "browser" | "communication" | "unknown"
    )
}

pub fn is_distraction_category(category: &str) -> bool {
    matches!(category, "social" | "entertainment" | "games")
}

pub fn categorize_app(app_name: &str) -> &'static str {
    let normalized = app_name.trim().to_lowercase();

    if normalized.starts_with("terminal:") || normalized.starts_with("iterm2:") {
        return "development";
    }

    let category_target = normalized
        .split_once(": ")
        .map(|(_, context)| context.trim())
        .unwrap_or(&normalized);

    for entry in CATEGORY_ENTRIES {
        if matches_token(category_target, entry.token) {
            return entry.category;
        }
    }

    "unknown"
}

pub fn browser_app_name(host: &str) -> Option<&'static str> {
    let normalized = normalize_host(host)?;

    BROWSER_ENTRIES
        .iter()
        .find(|entry| matches_host(&normalized, entry.host))
        .map(|entry| entry.name)
}

fn normalize_host(host: &str) -> Option<String> {
    let normalized = host
        .trim()
        .trim_start_matches("www.")
        .trim_end_matches('.')
        .to_lowercase();

    if normalized.is_empty() {
        return None;
    }

    Some(normalized)
}

fn matches_token(value: &str, token: &str) -> bool {
    value == token || value.ends_with(&format!(".{token}"))
}

fn matches_host(host: &str, candidate: &str) -> bool {
    host == candidate || host.ends_with(&format!(".{candidate}"))
}

struct CategoryEntry {
    token: &'static str,
    category: &'static str,
}

struct BrowserEntry {
    host: &'static str,
    name: &'static str,
}

const CATEGORY_ENTRIES: &[CategoryEntry] = &[
    CategoryEntry {
        token: "visual studio code",
        category: "development",
    },
    CategoryEntry {
        token: "code",
        category: "development",
    },
    CategoryEntry {
        token: "cursor",
        category: "development",
    },
    CategoryEntry {
        token: "zed",
        category: "development",
    },
    CategoryEntry {
        token: "xcode",
        category: "development",
    },
    CategoryEntry {
        token: "terminal",
        category: "development",
    },
    CategoryEntry {
        token: "iterm2",
        category: "development",
    },
    CategoryEntry {
        token: "codex",
        category: "development",
    },
    CategoryEntry {
        token: "codex cli",
        category: "development",
    },
    CategoryEntry {
        token: "claude",
        category: "development",
    },
    CategoryEntry {
        token: "claude code",
        category: "development",
    },
    CategoryEntry {
        token: "vim",
        category: "development",
    },
    CategoryEntry {
        token: "nvim",
        category: "development",
    },
    CategoryEntry {
        token: "node",
        category: "development",
    },
    CategoryEntry {
        token: "npm",
        category: "development",
    },
    CategoryEntry {
        token: "pnpm",
        category: "development",
    },
    CategoryEntry {
        token: "yarn",
        category: "development",
    },
    CategoryEntry {
        token: "python",
        category: "development",
    },
    CategoryEntry {
        token: "cargo",
        category: "development",
    },
    CategoryEntry {
        token: "rustc",
        category: "development",
    },
    CategoryEntry {
        token: "go",
        category: "development",
    },
    CategoryEntry {
        token: "git",
        category: "development",
    },
    CategoryEntry {
        token: "github",
        category: "development",
    },
    CategoryEntry {
        token: "gitlab",
        category: "development",
    },
    CategoryEntry {
        token: "bitbucket",
        category: "development",
    },
    CategoryEntry {
        token: "npmjs",
        category: "development",
    },
    CategoryEntry {
        token: "crates.io",
        category: "development",
    },
    CategoryEntry {
        token: "pypi",
        category: "development",
    },
    CategoryEntry {
        token: "docker hub",
        category: "development",
    },
    CategoryEntry {
        token: "figma",
        category: "productivity",
    },
    CategoryEntry {
        token: "sketch",
        category: "productivity",
    },
    CategoryEntry {
        token: "canva",
        category: "productivity",
    },
    CategoryEntry {
        token: "framer",
        category: "productivity",
    },
    CategoryEntry {
        token: "webflow",
        category: "productivity",
    },
    CategoryEntry {
        token: "dribbble",
        category: "productivity",
    },
    CategoryEntry {
        token: "behance",
        category: "productivity",
    },
    CategoryEntry {
        token: "slack",
        category: "communication",
    },
    CategoryEntry {
        token: "discord",
        category: "communication",
    },
    CategoryEntry {
        token: "microsoft teams",
        category: "communication",
    },
    CategoryEntry {
        token: "google chat",
        category: "communication",
    },
    CategoryEntry {
        token: "gmail",
        category: "communication",
    },
    CategoryEntry {
        token: "google meet",
        category: "communication",
    },
    CategoryEntry {
        token: "google docs",
        category: "browser",
    },
    CategoryEntry {
        token: "google drive",
        category: "browser",
    },
    CategoryEntry {
        token: "google sheets",
        category: "browser",
    },
    CategoryEntry {
        token: "google slides",
        category: "browser",
    },
    CategoryEntry {
        token: "google calendar",
        category: "communication",
    },
    CategoryEntry {
        token: "outlook",
        category: "communication",
    },
    CategoryEntry {
        token: "zoom",
        category: "communication",
    },
    CategoryEntry {
        token: "google chrome",
        category: "browser",
    },
    CategoryEntry {
        token: "chrome",
        category: "browser",
    },
    CategoryEntry {
        token: "arc",
        category: "browser",
    },
    CategoryEntry {
        token: "safari",
        category: "browser",
    },
    CategoryEntry {
        token: "firefox",
        category: "browser",
    },
    CategoryEntry {
        token: "comet",
        category: "browser",
    },
    CategoryEntry {
        token: "atlas",
        category: "browser",
    },
    CategoryEntry {
        token: "openai atlas",
        category: "browser",
    },
    CategoryEntry {
        token: "google search",
        category: "browser",
    },
    CategoryEntry {
        token: "perplexity",
        category: "browser",
    },
    CategoryEntry {
        token: "wikipedia",
        category: "browser",
    },
    CategoryEntry {
        token: "stack overflow",
        category: "development",
    },
    CategoryEntry {
        token: "mdn web docs",
        category: "development",
    },
    CategoryEntry {
        token: "docs.rs",
        category: "development",
    },
    CategoryEntry {
        token: "youtube",
        category: "entertainment",
    },
    CategoryEntry {
        token: "netflix",
        category: "entertainment",
    },
    CategoryEntry {
        token: "prime video",
        category: "entertainment",
    },
    CategoryEntry {
        token: "disney+",
        category: "entertainment",
    },
    CategoryEntry {
        token: "hotstar",
        category: "entertainment",
    },
    CategoryEntry {
        token: "twitch",
        category: "entertainment",
    },
    CategoryEntry {
        token: "spotify",
        category: "entertainment",
    },
    CategoryEntry {
        token: "vlc",
        category: "entertainment",
    },
    CategoryEntry {
        token: "reddit",
        category: "social",
    },
    CategoryEntry {
        token: "x",
        category: "social",
    },
    CategoryEntry {
        token: "twitter",
        category: "social",
    },
    CategoryEntry {
        token: "instagram",
        category: "social",
    },
    CategoryEntry {
        token: "facebook",
        category: "social",
    },
    CategoryEntry {
        token: "threads",
        category: "social",
    },
    CategoryEntry {
        token: "linkedin",
        category: "social",
    },
    CategoryEntry {
        token: "tiktok",
        category: "social",
    },
    CategoryEntry {
        token: "bluesky",
        category: "social",
    },
    // system
    CategoryEntry {
        token: "finder",
        category: "system",
    },
    CategoryEntry {
        token: "system settings",
        category: "system",
    },
];

const BROWSER_ENTRIES: &[BrowserEntry] = &[
    BrowserEntry {
        host: "github.com",
        name: "GitHub",
    },
    BrowserEntry {
        host: "gitlab.com",
        name: "GitLab",
    },
    BrowserEntry {
        host: "bitbucket.org",
        name: "Bitbucket",
    },
    BrowserEntry {
        host: "stackoverflow.com",
        name: "Stack Overflow",
    },
    BrowserEntry {
        host: "developer.mozilla.org",
        name: "MDN Web Docs",
    },
    BrowserEntry {
        host: "docs.rs",
        name: "Docs.rs",
    },
    BrowserEntry {
        host: "npmjs.com",
        name: "npmjs",
    },
    BrowserEntry {
        host: "crates.io",
        name: "crates.io",
    },
    BrowserEntry {
        host: "pypi.org",
        name: "PyPI",
    },
    BrowserEntry {
        host: "hub.docker.com",
        name: "Docker Hub",
    },
    BrowserEntry {
        host: "figma.com",
        name: "Figma",
    },
    BrowserEntry {
        host: "canva.com",
        name: "Canva",
    },
    BrowserEntry {
        host: "framer.com",
        name: "Framer",
    },
    BrowserEntry {
        host: "webflow.com",
        name: "Webflow",
    },
    BrowserEntry {
        host: "dribbble.com",
        name: "Dribbble",
    },
    BrowserEntry {
        host: "behance.net",
        name: "Behance",
    },
    BrowserEntry {
        host: "slack.com",
        name: "Slack",
    },
    BrowserEntry {
        host: "discord.com",
        name: "Discord",
    },
    BrowserEntry {
        host: "teams.microsoft.com",
        name: "Microsoft Teams",
    },
    BrowserEntry {
        host: "chat.google.com",
        name: "Google Chat",
    },
    BrowserEntry {
        host: "mail.google.com",
        name: "Gmail",
    },
    BrowserEntry {
        host: "meet.google.com",
        name: "Google Meet",
    },
    BrowserEntry {
        host: "docs.google.com",
        name: "Google Docs",
    },
    BrowserEntry {
        host: "drive.google.com",
        name: "Google Drive",
    },
    BrowserEntry {
        host: "sheets.google.com",
        name: "Google Sheets",
    },
    BrowserEntry {
        host: "slides.google.com",
        name: "Google Slides",
    },
    BrowserEntry {
        host: "calendar.google.com",
        name: "Google Calendar",
    },
    BrowserEntry {
        host: "outlook.live.com",
        name: "Outlook",
    },
    BrowserEntry {
        host: "outlook.office.com",
        name: "Outlook",
    },
    BrowserEntry {
        host: "zoom.us",
        name: "Zoom",
    },
    BrowserEntry {
        host: "google.com",
        name: "Google Search",
    },
    BrowserEntry {
        host: "perplexity.ai",
        name: "Perplexity",
    },
    BrowserEntry {
        host: "wikipedia.org",
        name: "Wikipedia",
    },
    BrowserEntry {
        host: "youtube.com",
        name: "YouTube",
    },
    BrowserEntry {
        host: "youtu.be",
        name: "YouTube",
    },
    BrowserEntry {
        host: "netflix.com",
        name: "Netflix",
    },
    BrowserEntry {
        host: "primevideo.com",
        name: "Prime Video",
    },
    BrowserEntry {
        host: "disneyplus.com",
        name: "Disney+",
    },
    BrowserEntry {
        host: "hotstar.com",
        name: "Hotstar",
    },
    BrowserEntry {
        host: "twitch.tv",
        name: "Twitch",
    },
    BrowserEntry {
        host: "spotify.com",
        name: "Spotify",
    },
    BrowserEntry {
        host: "reddit.com",
        name: "Reddit",
    },
    BrowserEntry {
        host: "x.com",
        name: "X",
    },
    BrowserEntry {
        host: "twitter.com",
        name: "Twitter",
    },
    BrowserEntry {
        host: "instagram.com",
        name: "Instagram",
    },
    BrowserEntry {
        host: "facebook.com",
        name: "Facebook",
    },
    BrowserEntry {
        host: "threads.net",
        name: "Threads",
    },
    BrowserEntry {
        host: "linkedin.com",
        name: "LinkedIn",
    },
    BrowserEntry {
        host: "tiktok.com",
        name: "TikTok",
    },
    BrowserEntry {
        host: "bsky.app",
        name: "Bluesky",
    },
    // communication
    BrowserEntry {
        host: "zoho.com",
        name: "Zoho",
    },
    BrowserEntry {
        host: "loom.com",
        name: "Loom",
    },
    BrowserEntry {
        host: "calendly.com",
        name: "Calendly",
    },
    BrowserEntry {
        host: "hubspot.com",
        name: "HubSpot",
    },
    BrowserEntry {
        host: "intercom.com",
        name: "Intercom",
    },
    BrowserEntry {
        host: "zendesk.com",
        name: "Zendesk",
    },
    BrowserEntry {
        host: "freshdesk.com",
        name: "Freshdesk",
    },
    BrowserEntry {
        host: "web.whatsapp.com",
        name: "WhatsApp",
    },
    BrowserEntry {
        host: "web.telegram.org",
        name: "Telegram",
    },
    // productivity
    BrowserEntry {
        host: "notion.so",
        name: "Notion",
    },
    BrowserEntry {
        host: "trello.com",
        name: "Trello",
    },
    BrowserEntry {
        host: "asana.com",
        name: "Asana",
    },
    BrowserEntry {
        host: "airtable.com",
        name: "Airtable",
    },
    BrowserEntry {
        host: "monday.com",
        name: "Monday",
    },
    BrowserEntry {
        host: "clickup.com",
        name: "ClickUp",
    },
    BrowserEntry {
        host: "atlassian.net",
        name: "Jira",
    },
    BrowserEntry {
        host: "salesforce.com",
        name: "Salesforce",
    },
    BrowserEntry {
        host: "basecamp.com",
        name: "Basecamp",
    },
    // development
    BrowserEntry {
        host: "linear.app",
        name: "Linear",
    },
    BrowserEntry {
        host: "claude.ai",
        name: "Claude",
    },
    BrowserEntry {
        host: "chatgpt.com",
        name: "ChatGPT",
    },
    BrowserEntry {
        host: "chat.openai.com",
        name: "ChatGPT",
    },
    // design
    BrowserEntry {
        host: "miro.com",
        name: "Miro",
    },
    BrowserEntry {
        host: "whimsical.com",
        name: "Whimsical",
    },
    BrowserEntry {
        host: "spline.design",
        name: "Spline",
    },
];

#[cfg(test)]
mod tests {
    use super::{browser_app_name, categorize_app};

    #[test]
    fn maps_browser_hosts_to_product_names() {
        assert_eq!(browser_app_name("chat.google.com"), Some("Google Chat"));
        assert_eq!(browser_app_name("www.youtube.com"), Some("YouTube"));
        assert_eq!(
            browser_app_name("developer.mozilla.org"),
            Some("MDN Web Docs")
        );
    }

    #[test]
    fn categorizes_product_names_and_terminal_context() {
        assert_eq!(categorize_app("Google Chat"), "communication");
        assert_eq!(
            categorize_app("Google Chrome: Google Chat"),
            "communication"
        );
        assert_eq!(categorize_app("Arc: Figma"), "productivity");
        assert_eq!(categorize_app("Google Chrome"), "browser");
        assert_eq!(categorize_app("YouTube"), "entertainment");
        assert_eq!(categorize_app("Terminal: codex"), "development");
    }
}
