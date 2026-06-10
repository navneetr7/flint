use rusqlite::{params, Connection, Result};

pub const CURRENT_SCHEMA_VERSION: i64 = 8;

pub fn run_migrations(connection: &Connection) -> Result<()> {
    ensure_migration_table(connection)?;
    apply_initial_schema(connection)?;
    apply_ai_classification_schema(connection)?;
    apply_daily_summary_schema(connection)?;
    apply_hourly_summary_schema(connection)?;
    apply_daily_summary_rich_fields(connection)?;
    apply_longest_focus_field(connection)?;
    apply_focus_milestone_target(connection)?;
    apply_onboarding_flag(connection)?;
    seed_classification_rules(connection)?;
    connection.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;

    Ok(())
}

fn apply_onboarding_flag(connection: &Connection) -> Result<()> {
    add_column_if_missing(
        connection,
        "privacy_settings",
        "onboarding_completed",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    record_migration(connection, 8, "onboarding_flag")?;
    Ok(())
}

fn apply_focus_milestone_target(connection: &Connection) -> Result<()> {
    add_column_if_missing(
        connection,
        "privacy_settings",
        "focus_milestone_target_minutes",
        "INTEGER NOT NULL DEFAULT 15",
    )?;
    record_migration(connection, 7, "focus_milestone_target")?;
    Ok(())
}

fn apply_longest_focus_field(connection: &Connection) -> Result<()> {
    let has_column: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('daily_summaries') WHERE name = 'longest_focus_seconds'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false);

    if !has_column {
        connection.execute_batch(
            "ALTER TABLE daily_summaries ADD COLUMN longest_focus_seconds INTEGER NOT NULL DEFAULT 0;",
        )?;
    }

    record_migration(connection, 6, "daily_summary_longest_focus")?;
    Ok(())
}

fn apply_daily_summary_rich_fields(connection: &Connection) -> Result<()> {
    // Idempotent: only ALTER if the column doesn't exist yet.
    let has_column: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('daily_summaries') WHERE name = 'time_wasters'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false);

    if !has_column {
        connection.execute_batch(
            "
            ALTER TABLE daily_summaries ADD COLUMN time_wasters TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE daily_summaries ADD COLUMN main_distractions TEXT NOT NULL DEFAULT '[]';
            ",
        )?;
    }

    record_migration(connection, 5, "daily_summary_rich_fields")?;
    Ok(())
}

fn apply_hourly_summary_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS hourly_summaries (
            local_date TEXT NOT NULL,
            hour        INTEGER NOT NULL,
            summary     TEXT NOT NULL,
            main_drift_story TEXT NOT NULL,
            improvement_tip  TEXT NOT NULL,
            focus_seconds    INTEGER NOT NULL DEFAULT 0,
            learning_seconds INTEGER NOT NULL DEFAULT 0,
            drift_seconds    INTEGER NOT NULL DEFAULT 0,
            model       TEXT NOT NULL DEFAULT 'local',
            generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (local_date, hour)
        );
        ",
    )?;
    record_migration(connection, 4, "hourly_ai_summaries")?;

    Ok(())
}

fn apply_daily_summary_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS daily_summaries (
            local_date TEXT PRIMARY KEY NOT NULL,
            timezone TEXT NOT NULL,
            summary TEXT NOT NULL,
            main_drift_story TEXT NOT NULL,
            improvement_tip TEXT NOT NULL,
            focus_seconds INTEGER NOT NULL DEFAULT 0,
            learning_seconds INTEGER NOT NULL DEFAULT 0,
            drift_seconds INTEGER NOT NULL DEFAULT 0,
            model TEXT NOT NULL,
            generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;
    record_migration(connection, 3, "daily_ai_summaries")?;

    Ok(())
}

fn apply_ai_classification_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            provider TEXT NOT NULL DEFAULT 'deepseek',
            model TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
            base_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
            encrypted_api_key TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ai_classifications (
            context_hash TEXT PRIMARY KEY NOT NULL,
            target_kind TEXT NOT NULL,
            app_name TEXT NOT NULL,
            host TEXT,
            title TEXT,
            display_name TEXT NOT NULL,
            category TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO ai_settings (
            id,
            enabled,
            provider,
            model,
            base_url
        ) VALUES (
            1,
            0,
            'deepseek',
            'deepseek-v4-pro',
            'https://api.deepseek.com'
        );
        ",
    )?;
    record_migration(connection, 2, "ai_classification_cache")?;

    Ok(())
}

fn ensure_migration_table(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;

    Ok(())
}

fn apply_initial_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS attention_events (
            id TEXT PRIMARY KEY NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            category TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            is_idle INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS privacy_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            private_mode_enabled INTEGER NOT NULL DEFAULT 0,
            collect_window_titles INTEGER NOT NULL DEFAULT 1,
            idle_threshold_seconds INTEGER NOT NULL DEFAULT 600
        );

        CREATE TABLE IF NOT EXISTS excluded_apps (
            app_name TEXT PRIMARY KEY NOT NULL
        );

        CREATE TABLE IF NOT EXISTS classification_rules (
            token TEXT PRIMARY KEY NOT NULL,
            display_name TEXT NOT NULL,
            category TEXT NOT NULL,
            match_kind TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 100,
            source TEXT NOT NULL DEFAULT 'seed'
        );

        INSERT OR IGNORE INTO privacy_settings (
            id,
            private_mode_enabled,
            collect_window_titles
        ) VALUES (1, 0, 1);

        UPDATE privacy_settings
        SET collect_window_titles = 1
        WHERE id = 1;

        DELETE FROM attention_events
        WHERE id LIKE 'demo-%';
        ",
    )?;

    add_column_if_missing(
        connection,
        "privacy_settings",
        "idle_threshold_seconds",
        "INTEGER NOT NULL DEFAULT 600",
    )?;
    connection.execute(
        "
        UPDATE privacy_settings
        SET idle_threshold_seconds = 600
        WHERE id = 1
          AND idle_threshold_seconds < 600
        ",
        [],
    )?;
    add_column_if_missing(
        connection,
        "privacy_settings",
        "show_tray_label",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    record_migration(connection, 1, "initial_local_schema")?;

    Ok(())
}

fn record_migration(connection: &Connection, version: i64, name: &str) -> Result<()> {
    connection.execute(
        "
        INSERT OR IGNORE INTO schema_migrations (version, name)
        VALUES (?1, ?2)
        ",
        params![version, name],
    )?;

    Ok(())
}

fn seed_classification_rules(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare(
        "
        INSERT OR REPLACE INTO classification_rules (
            token,
            display_name,
            category,
            match_kind,
            priority,
            source
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'seed')
        ",
    )?;

    for (token, display_name, category, match_kind, priority) in CLASSIFICATION_RULES {
        statement.execute(params![token, display_name, category, match_kind, priority])?;
    }

    Ok(())
}

fn add_column_if_missing(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;

    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }

    connection.execute(
        &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
        [],
    )?;

    Ok(())
}

const CLASSIFICATION_RULES: &[(&str, &str, &str, &str, i64)] = &[
    ("google chrome", "Google Chrome", "browser", "exact", 10),
    ("chrome", "Chrome", "browser", "exact", 10),
    ("arc", "Arc", "browser", "exact", 10),
    ("safari", "Safari", "browser", "exact", 10),
    ("firefox", "Firefox", "browser", "exact", 10),
    ("comet", "Comet", "browser", "exact", 10),
    ("atlas", "Atlas", "browser", "exact", 10),
    ("openai atlas", "OpenAI Atlas", "browser", "exact", 10),
    ("flint", "Flint", "system", "exact", 10),
    ("finder", "Finder", "system", "exact", 10),
    ("flameshot", "Flameshot", "system", "exact", 10),
    // Claude desktop app — the CLI surfaces as "Claude Code" via terminal process detection
    ("claude", "Claude", "development", "exact", 10),
    (
        "visual studio code",
        "Visual Studio Code",
        "development",
        "exact",
        10,
    ),
    ("code", "Code", "development", "exact", 10),
    ("cursor", "Cursor", "development", "exact", 10),
    ("zed", "Zed", "development", "exact", 10),
    ("xcode", "Xcode", "development", "exact", 10),
    ("terminal", "Terminal", "development", "exact", 10),
    ("iterm2", "iTerm2", "development", "exact", 10),
    // OpenAI Codex desktop app — the CLI surfaces as "Codex CLI" via terminal process detection
    ("codex", "OpenAI Codex", "development", "exact", 10),
    ("codex cli", "Codex CLI", "development", "exact", 10),
    ("claude code", "Claude Code", "development", "exact", 10),
    ("vim", "Vim", "development", "exact", 10),
    ("nvim", "Neovim", "development", "exact", 10),
    ("node", "Node.js", "development", "exact", 10),
    ("npm", "npm", "development", "exact", 10),
    ("pnpm", "pnpm", "development", "exact", 10),
    ("yarn", "Yarn", "development", "exact", 10),
    ("python", "Python", "development", "exact", 10),
    ("python3", "Python", "development", "exact", 10),
    ("cargo", "Cargo", "development", "exact", 10),
    ("rustc", "Rust", "development", "exact", 10),
    ("go", "Go", "development", "exact", 10),
    ("git", "Git", "development", "exact", 10),
    ("figma", "Figma", "design", "exact", 10),
    ("sketch", "Sketch", "design", "exact", 10),
    ("canva", "Canva", "design", "exact", 10),
    ("framer", "Framer", "design", "exact", 10),
    ("webflow", "Webflow", "design", "exact", 10),
    ("notion", "Notion", "productivity", "exact", 10),
    ("obsidian", "Obsidian", "productivity", "exact", 10),
    ("todoist", "Todoist", "productivity", "exact", 10),
    ("things", "Things", "productivity", "exact", 10),
    ("linear", "Linear", "productivity", "exact", 10),
    ("jira", "Jira", "productivity", "exact", 10),
    ("trello", "Trello", "productivity", "exact", 10),
    ("airtable", "Airtable", "productivity", "exact", 10),
    ("asana", "Asana", "productivity", "exact", 10),
    ("evernote", "Evernote", "productivity", "exact", 10),
    ("bear", "Bear", "productivity", "exact", 10),
    ("craft", "Craft", "productivity", "exact", 10),
    ("slack", "Slack", "communication", "exact", 10),
    ("discord", "Discord", "communication", "exact", 10),
    (
        "microsoft teams",
        "Microsoft Teams",
        "communication",
        "exact",
        10,
    ),
    ("zoom", "Zoom", "communication", "exact", 10),
    ("youtube", "YouTube", "entertainment", "exact", 10),
    ("netflix", "Netflix", "entertainment", "exact", 10),
    ("prime video", "Prime Video", "entertainment", "exact", 10),
    ("disney+", "Disney+", "entertainment", "exact", 10),
    ("hotstar", "Hotstar", "entertainment", "exact", 10),
    ("spotify", "Spotify", "entertainment", "exact", 10),
    ("vlc", "VLC", "entertainment", "exact", 10),
    ("reddit", "Reddit", "social", "exact", 10),
    ("x", "X", "social", "exact", 10),
    ("twitter", "Twitter", "social", "exact", 10),
    ("instagram", "Instagram", "social", "exact", 10),
    ("facebook", "Facebook", "social", "exact", 10),
    ("threads", "Threads", "social", "exact", 10),
    ("linkedin", "LinkedIn", "social", "exact", 10),
    ("tiktok", "TikTok", "social", "exact", 10),
    ("snapchat", "Snapchat", "social", "exact", 10),
    ("pinterest", "Pinterest", "social", "exact", 10),
    ("github.com", "GitHub", "development", "host", 20),
    ("gitlab.com", "GitLab", "development", "host", 20),
    ("bitbucket.org", "Bitbucket", "development", "host", 20),
    (
        "stackoverflow.com",
        "Stack Overflow",
        "development",
        "host",
        20,
    ),
    (
        "developer.mozilla.org",
        "MDN Web Docs",
        "development",
        "host",
        20,
    ),
    ("docs.rs", "Docs.rs", "development", "host", 20),
    ("npmjs.com", "npmjs", "development", "host", 20),
    ("crates.io", "crates.io", "development", "host", 20),
    ("pypi.org", "PyPI", "development", "host", 20),
    ("hub.docker.com", "Docker Hub", "development", "host", 20),
    ("vercel.com", "Vercel", "development", "host", 20),
    ("netlify.com", "Netlify", "development", "host", 20),
    ("figma.com", "Figma", "design", "host", 20),
    ("canva.com", "Canva", "design", "host", 20),
    ("framer.com", "Framer", "design", "host", 20),
    ("webflow.com", "Webflow", "design", "host", 20),
    ("dribbble.com", "Dribbble", "design", "host", 20),
    ("behance.net", "Behance", "design", "host", 20),
    ("notion.so", "Notion", "productivity", "host", 20),
    ("todoist.com", "Todoist", "productivity", "host", 20),
    ("linear.app", "Linear", "productivity", "host", 20),
    ("trello.com", "Trello", "productivity", "host", 20),
    ("airtable.com", "Airtable", "productivity", "host", 20),
    ("app.asana.com", "Asana", "productivity", "host", 20),
    ("evernote.com", "Evernote", "productivity", "host", 20),
    ("atlassian.net", "Jira", "productivity", "host", 20),
    ("monday.com", "Monday", "productivity", "host", 20),
    ("clickup.com", "ClickUp", "productivity", "host", 20),
    ("desk.zoho.eu", "Zoho Desk", "productivity", "host", 20),
    ("desk.zoho.com", "Zoho Desk", "productivity", "host", 20),
    ("zoho.com", "Zoho", "productivity", "host", 20),
    ("zendesk.com", "Zendesk", "productivity", "host", 20),
    ("intercom.com", "Intercom", "productivity", "host", 20),
    ("freshdesk.com", "Freshdesk", "productivity", "host", 20),
    ("hubspot.com", "HubSpot", "productivity", "host", 20),
    ("salesforce.com", "Salesforce", "productivity", "host", 20),
    ("slack.com", "Slack", "communication", "host", 20),
    ("discord.com", "Discord", "communication", "host", 20),
    (
        "teams.microsoft.com",
        "Microsoft Teams",
        "communication",
        "host",
        20,
    ),
    (
        "chat.google.com",
        "Google Chat",
        "communication",
        "host",
        20,
    ),
    ("mail.google.com", "Gmail", "communication", "host", 20),
    (
        "meet.google.com",
        "Google Meet",
        "communication",
        "host",
        20,
    ),
    (
        "calendar.google.com",
        "Google Calendar",
        "communication",
        "host",
        20,
    ),
    ("outlook.live.com", "Outlook", "communication", "host", 20),
    ("outlook.office.com", "Outlook", "communication", "host", 20),
    ("zoom.us", "Zoom", "communication", "host", 20),
    ("web.whatsapp.com", "WhatsApp", "communication", "host", 20),
    ("telegram.org", "Telegram", "communication", "host", 20),
    ("docs.google.com", "Google Docs", "browser", "host", 20),
    ("drive.google.com", "Google Drive", "browser", "host", 20),
    ("sheets.google.com", "Google Sheets", "browser", "host", 20),
    ("slides.google.com", "Google Slides", "browser", "host", 20),
    ("google.com", "Google Search", "browser", "host", 100),
    ("perplexity.ai", "Perplexity", "browser", "host", 20),
    ("wikipedia.org", "Wikipedia", "browser", "host", 20),
    ("chatgpt.com", "ChatGPT", "browser", "host", 20),
    ("claude.ai", "Claude", "browser", "host", 20),
    ("youtube.com", "YouTube", "entertainment", "host", 20),
    ("youtu.be", "YouTube", "entertainment", "host", 20),
    ("netflix.com", "Netflix", "entertainment", "host", 20),
    ("primevideo.com", "Prime Video", "entertainment", "host", 20),
    ("disneyplus.com", "Disney+", "entertainment", "host", 20),
    ("hotstar.com", "Hotstar", "entertainment", "host", 20),
    ("jiocinema.com", "JioCinema", "entertainment", "host", 20),
    ("hulu.com", "Hulu", "entertainment", "host", 20),
    ("max.com", "Max", "entertainment", "host", 20),
    ("hbomax.com", "HBO Max", "entertainment", "host", 20),
    ("twitch.tv", "Twitch", "entertainment", "host", 20),
    ("spotify.com", "Spotify", "entertainment", "host", 20),
    ("soundcloud.com", "SoundCloud", "entertainment", "host", 20),
    (
        "crunchyroll.com",
        "Crunchyroll",
        "entertainment",
        "host",
        20,
    ),
    ("sonyliv.com", "SonyLIV", "entertainment", "host", 20),
    ("zee5.com", "ZEE5", "entertainment", "host", 20),
    ("reddit.com", "Reddit", "social", "host", 20),
    ("x.com", "X", "social", "host", 20),
    ("twitter.com", "Twitter", "social", "host", 20),
    ("instagram.com", "Instagram", "social", "host", 20),
    ("facebook.com", "Facebook", "social", "host", 20),
    ("threads.net", "Threads", "social", "host", 20),
    ("linkedin.com", "LinkedIn", "social", "host", 20),
    ("tiktok.com", "TikTok", "social", "host", 20),
    ("snapchat.com", "Snapchat", "social", "host", 20),
    ("pinterest.com", "Pinterest", "social", "host", 20),
    ("tumblr.com", "Tumblr", "social", "host", 20),
    ("bsky.app", "Bluesky", "social", "host", 20),
];

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{run_migrations, CURRENT_SCHEMA_VERSION};

    #[test]
    fn records_current_schema_version() {
        let connection = Connection::open_in_memory().expect("in-memory database");

        run_migrations(&connection).expect("migrations");

        let migration_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
                [CURRENT_SCHEMA_VERSION],
                |row| row.get(0),
            )
            .expect("migration count");
        let user_version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user_version");

        assert_eq!(migration_count, 1);
        assert_eq!(user_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn keeps_migrations_idempotent() {
        let connection = Connection::open_in_memory().expect("in-memory database");

        run_migrations(&connection).expect("first migration run");
        run_migrations(&connection).expect("second migration run");

        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");

        assert_eq!(migration_count, 8);
    }

    #[test]
    fn upgrades_legacy_privacy_settings_with_idle_threshold() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "
                CREATE TABLE privacy_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    private_mode_enabled INTEGER NOT NULL DEFAULT 0,
                    collect_window_titles INTEGER NOT NULL DEFAULT 0
                );

                INSERT INTO privacy_settings (
                    id,
                    private_mode_enabled,
                    collect_window_titles
                ) VALUES (1, 0, 1);
                ",
            )
            .expect("legacy schema");

        run_migrations(&connection).expect("migrations");

        let idle_threshold_seconds: i64 = connection
            .query_row(
                "SELECT idle_threshold_seconds FROM privacy_settings WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("idle threshold");

        assert_eq!(idle_threshold_seconds, 600);
    }
}
