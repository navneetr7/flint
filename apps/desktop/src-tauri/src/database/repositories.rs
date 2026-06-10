pub mod attention_events {
    use rusqlite::{params, Connection, Result};

    use crate::attention::event::AttentionEvent;
    use crate::encryption::vault::LocalVault;

    pub struct AttentionEventRepository<'a> {
        connection: &'a Connection,
    }

    impl<'a> AttentionEventRepository<'a> {
        pub fn new(connection: &'a Connection) -> Self {
            Self { connection }
        }

        pub fn connection(&self) -> &'a Connection {
            self.connection
        }

        pub fn list_recent(&self, limit: u32) -> Result<Vec<AttentionEvent>> {
            let mut statement = self.connection.prepare(
                "
                SELECT id, app_name, window_title, category, started_at, ended_at, duration_seconds, is_idle
                FROM attention_events
                ORDER BY started_at DESC
                LIMIT ?1
                ",
            )?;

            let events = statement
                .query_map([limit], |row| {
                    Ok(AttentionEvent {
                        id: row.get(0)?,
                        app_name: row.get(1)?,
                        window_title: decrypt_title(row.get(2)?)?,
                        category: row.get(3)?,
                        started_at: row.get(4)?,
                        ended_at: row.get(5)?,
                        duration_seconds: row.get(6)?,
                        is_idle: row.get::<_, u8>(7)? == 1,
                    })
                })?
                .collect::<Result<Vec<_>>>()?;

            Ok(events)
        }

        pub fn list_between(&self, start_at: &str, end_at: &str) -> Result<Vec<AttentionEvent>> {
            let mut statement = self.connection.prepare(
                "
                SELECT id, app_name, window_title, category, started_at, ended_at, duration_seconds, is_idle
                FROM attention_events
                WHERE ended_at > ?1
                  AND started_at < ?2
                ORDER BY started_at ASC
                ",
            )?;

            let events = statement
                .query_map(params![start_at, end_at], |row| {
                    Ok(AttentionEvent {
                        id: row.get(0)?,
                        app_name: row.get(1)?,
                        window_title: decrypt_title(row.get(2)?)?,
                        category: row.get(3)?,
                        started_at: row.get(4)?,
                        ended_at: row.get(5)?,
                        duration_seconds: row.get(6)?,
                        is_idle: row.get::<_, u8>(7)? == 1,
                    })
                })?
                .collect::<Result<Vec<_>>>()?;

            Ok(events)
        }

        pub fn latest(&self) -> Result<Option<AttentionEvent>> {
            let mut statement = self.connection.prepare(
                "
                SELECT id, app_name, window_title, category, started_at, ended_at, duration_seconds, is_idle
                FROM attention_events
                ORDER BY ended_at DESC
                LIMIT 1
                ",
            )?;

            let mut rows = statement.query([])?;

            if let Some(row) = rows.next()? {
                return Ok(Some(AttentionEvent {
                    id: row.get(0)?,
                    app_name: row.get(1)?,
                    window_title: decrypt_title(row.get(2)?)?,
                    category: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                    duration_seconds: row.get(6)?,
                    is_idle: row.get::<_, u8>(7)? == 1,
                }));
            }

            Ok(None)
        }

        pub fn insert(&self, event: &AttentionEvent) -> Result<()> {
            let encrypted_title: Option<String> = event
                .window_title
                .as_deref()
                .map(LocalVault::encrypt_field)
                .transpose()
                .map_err(encrypt_error)?;

            self.connection.execute(
                "
                INSERT INTO attention_events (
                    id,
                    app_name,
                    window_title,
                    category,
                    started_at,
                    ended_at,
                    duration_seconds,
                    is_idle
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    &event.id,
                    &event.app_name,
                    &encrypted_title,
                    &event.category,
                    &event.started_at,
                    &event.ended_at,
                    event.duration_seconds,
                    event.is_idle as u8
                ],
            )?;

            Ok(())
        }

        pub fn extend(&self, event: &AttentionEvent) -> Result<()> {
            self.connection.execute(
                "
                UPDATE attention_events
                SET ended_at = ?1,
                    duration_seconds = ?2
                WHERE id = ?3
                ",
                params![&event.ended_at, event.duration_seconds, &event.id],
            )?;

            Ok(())
        }

        pub fn delete_all(&self) -> Result<()> {
            self.connection
                .execute("DELETE FROM attention_events", [])?;
            Ok(())
        }
    }

    /// Decrypts a stored window_title. Returns `None` when the stored value is `None` or
    /// decryption fails (safe fallback — never surfaces corrupted ciphertext to the UI).
    fn decrypt_title(raw: Option<String>) -> Result<Option<String>> {
        Ok(raw.and_then(|v| LocalVault::decrypt_field(&v).ok()))
    }

    fn encrypt_error(message: String) -> rusqlite::Error {
        rusqlite::Error::ToSqlConversionFailure(
            std::io::Error::new(std::io::ErrorKind::Other, message).into(),
        )
    }
}

pub mod settings {
    use rusqlite::{params, Connection, Result};
    use serde::Serialize;

    #[derive(Debug, Clone, Serialize)]
    pub struct PrivacySettings {
        pub private_mode_enabled: bool,
        pub collect_window_titles: bool,
        pub idle_threshold_seconds: u64,
        pub excluded_apps: Vec<String>,
        pub show_tray_label: bool,
        pub focus_milestone_target_minutes: u64,
        pub onboarding_completed: bool,
    }

    pub struct SettingsRepository<'a> {
        connection: &'a Connection,
    }

    impl<'a> SettingsRepository<'a> {
        pub fn new(connection: &'a Connection) -> Self {
            Self { connection }
        }

        pub fn get_privacy_settings(&self) -> Result<PrivacySettings> {
            let (private_mode_enabled, collect_window_titles, idle_threshold_seconds, show_tray_label, focus_milestone_target_minutes, onboarding_completed): (
                u8,
                u8,
                u64,
                u8,
                u64,
                u8,
            ) = self.connection.query_row(
                "
                SELECT private_mode_enabled, collect_window_titles, idle_threshold_seconds,
                       show_tray_label,
                       COALESCE(focus_milestone_target_minutes, 15),
                       COALESCE(onboarding_completed, 0)
                FROM privacy_settings
                WHERE id = 1
                ",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )?;

            let mut statement = self
                .connection
                .prepare("SELECT app_name FROM excluded_apps ORDER BY app_name ASC")?;
            let excluded_apps = statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<String>>>()?;

            Ok(PrivacySettings {
                private_mode_enabled: private_mode_enabled == 1,
                collect_window_titles: collect_window_titles == 1,
                idle_threshold_seconds,
                excluded_apps,
                show_tray_label: show_tray_label == 1,
                focus_milestone_target_minutes: focus_milestone_target_minutes.max(15),
                onboarding_completed: onboarding_completed == 1,
            })
        }

        pub fn is_onboarding_completed(&self) -> Result<bool> {
            let v: u8 = self.connection.query_row(
                "SELECT COALESCE(onboarding_completed, 0) FROM privacy_settings WHERE id = 1",
                [],
                |row| row.get(0),
            )?;
            Ok(v == 1)
        }

        pub fn mark_onboarding_completed(&self) -> Result<()> {
            self.connection.execute(
                "UPDATE privacy_settings SET onboarding_completed = 1 WHERE id = 1",
                [],
            )?;
            Ok(())
        }

        pub fn set_focus_milestone_target_minutes(&self, minutes: u64) -> Result<()> {
            self.connection.execute(
                "UPDATE privacy_settings SET focus_milestone_target_minutes = ?1 WHERE id = 1",
                [minutes.max(15)],
            )?;
            Ok(())
        }

        pub fn set_private_mode(&self, enabled: bool) -> Result<()> {
            self.connection.execute(
                "UPDATE privacy_settings SET private_mode_enabled = ?1 WHERE id = 1",
                [enabled as u8],
            )?;
            Ok(())
        }

        pub fn set_collect_window_titles(&self, enabled: bool) -> Result<()> {
            self.connection.execute(
                "UPDATE privacy_settings SET collect_window_titles = ?1 WHERE id = 1",
                [enabled as u8],
            )?;
            Ok(())
        }

        pub fn set_idle_threshold_seconds(&self, seconds: u64) -> Result<()> {
            self.connection.execute(
                "UPDATE privacy_settings SET idle_threshold_seconds = ?1 WHERE id = 1",
                [seconds.clamp(15, 900)],
            )?;
            Ok(())
        }

        pub fn set_show_tray_label(&self, enabled: bool) -> Result<()> {
            self.connection.execute(
                "UPDATE privacy_settings SET show_tray_label = ?1 WHERE id = 1",
                [enabled as u8],
            )?;
            Ok(())
        }

        pub fn add_excluded_app(&self, app_name: &str) -> Result<()> {
            self.connection.execute(
                "INSERT OR IGNORE INTO excluded_apps (app_name) VALUES (?1)",
                params![app_name.trim()],
            )?;
            Ok(())
        }

        pub fn remove_excluded_app(&self, app_name: &str) -> Result<()> {
            self.connection.execute(
                "DELETE FROM excluded_apps WHERE app_name = ?1",
                params![app_name.trim()],
            )?;
            Ok(())
        }
    }
}

pub mod classification {
    use rusqlite::{params, Connection, OptionalExtension, Result};
    use sha2::{Digest, Sha256};

    use crate::{ai::classifier::classify_with_ai, encryption::vault::LocalVault};

    #[derive(Debug, Clone)]
    pub struct ClassifiedApp {
        pub display_name: String,
        pub category: String,
    }

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    pub struct ClassificationRule {
        pub token: String,
        pub display_name: String,
        pub category: String,
        pub match_kind: String,
        pub priority: i64,
        pub source: String,
    }

    #[derive(Debug, Clone, serde::Serialize)]
    pub struct AiSettings {
        pub enabled: bool,
        pub provider: String,
        pub model: String,
        pub base_url: String,
        pub has_api_key: bool,
    }

    #[derive(Debug, Clone)]
    pub struct AiClassification {
        pub context_hash: String,
        pub target_kind: String,
        pub app_name: String,
        pub host: Option<String>,
        pub title: Option<String>,
        pub display_name: String,
        pub category: String,
        pub provider: String,
        pub model: String,
    }

    #[derive(Debug, Clone)]
    struct StoredAiSettings {
        enabled: bool,
        provider: String,
        model: String,
        base_url: String,
        encrypted_api_key: Option<String>,
    }

    #[derive(Debug, Clone)]
    pub struct AiRequestConfig {
        pub model: String,
        pub base_url: String,
        pub api_key: String,
    }

    /// All data needed to make an AI classification call without holding the DB lock.
    #[derive(Debug, Clone)]
    pub struct AiPendingRequest {
        pub target_kind: String,
        pub target_hash: String,
        pub app_name: String,
        pub prefix: Option<String>,
        pub host: Option<String>,
        pub title: Option<String>,
        pub fallback_display_name: String,
        pub base_url: String,
        pub model: String,
        pub api_key: String,
        pub provider: String,
    }

    #[derive(Debug, Clone)]
    struct AiTarget {
        kind: String,
        hash: String,
        app_name: String,
        prefix: Option<String>,
        host: Option<String>,
        title: Option<String>,
        fallback_display_name: String,
    }

    pub struct ClassificationRepository<'a> {
        connection: &'a Connection,
    }

    impl<'a> ClassificationRepository<'a> {
        pub fn new(connection: &'a Connection) -> Self {
            Self { connection }
        }

        pub fn classify_app(&self, app_name: &str) -> Result<ClassifiedApp> {
            let normalized = app_name.trim().to_lowercase();

            if normalized.starts_with("terminal:") || normalized.starts_with("iterm2:") {
                return Ok(ClassifiedApp {
                    display_name: app_name.trim().to_string(),
                    category: "development".to_string(),
                });
            }

            if let Some((prefix, context)) = app_name.split_once(": ") {
                if let Some(rule) = self.find_rule(context)? {
                    return Ok(ClassifiedApp {
                        display_name: format!("{}: {}", prefix.trim(), rule.display_name),
                        category: rule.category,
                    });
                }

                return Ok(ClassifiedApp {
                    display_name: app_name.trim().to_string(),
                    category: "browser".to_string(),
                });
            }

            if let Some(rule) = self.find_rule(app_name)? {
                return Ok(ClassifiedApp {
                    display_name: rule.display_name,
                    category: rule.category,
                });
            }

            Ok(ClassifiedApp {
                display_name: app_name.trim().to_string(),
                category: "unknown".to_string(),
            })
        }

        /// Like `classify_app` but also checks `ai_classifications` for YouTube title cache.
        /// Never makes an HTTP call — read-only fast path for the tracker hot loop.
        pub fn classify_app_reading_cache(
            &self,
            app_name: &str,
            window_title: &Option<String>,
        ) -> Result<ClassifiedApp> {
            let local = self.classify_app(app_name)?;

            let Some(title) = window_title
                .as_ref()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
            else {
                return Ok(local);
            };

            let Some((_prefix, context)) = app_name.split_once(": ") else {
                return Ok(local);
            };
            let host = normalize_token(context);

            if is_youtube_host(&host) {
                let canonical = youtube_hash_host();
                let hash = context_hash("youtube_title", &[canonical, &title]);
                if let Some(cached) = self.find_ai_classification(&hash)? {
                    // Keep the stable seed-rule display_name so app_name stays identical
                    // across pre- and post-classification events — mergeAdjacentSessions
                    // requires an exact appName match.
                    return Ok(ClassifiedApp {
                        display_name: local.display_name.clone(),
                        category: cached.category.clone(),
                    });
                }
                return Ok(local);
            }

            // All other browser sites: check per-title cache
            let hash = context_hash("page_title", &[&host, &title]);
            if let Some(cached) = self.find_ai_classification(&hash)? {
                return Ok(ClassifiedApp {
                    display_name: local.display_name.clone(),
                    category: cached.category.clone(),
                });
            }

            Ok(local)
        }

        pub fn classify_app_with_context(
            &self,
            app_name: &str,
            window_title: &Option<String>,
            timeout: std::time::Duration,
        ) -> Result<ClassifiedApp> {
            let local = self.classify_app(app_name)?;
            let Some(target) = ai_target(app_name, window_title, &local) else {
                return Ok(local);
            };

            // youtube_title / page_title: cache by title hash in ai_classifications
            // (content-specific — the same domain can be learning or entertainment on different pages)
            if target.kind == "youtube_title" || target.kind == "page_title" {
                if let Some(cached) = self.find_ai_classification(&target.hash)? {
                    return Ok(classified_from_ai(&target, &cached));
                }
            }

            let settings = self.deepseek_settings()?;
            if !settings.enabled {
                return Ok(local);
            }
            let encrypted_api_key = settings.encrypted_api_key.as_ref().ok_or_else(|| {
                ai_error("AI classification is enabled but no DeepSeek API key is saved")
            })?;
            let api_key = LocalVault::decrypt_secret(encrypted_api_key).map_err(ai_error)?;

            let ai_result = classify_with_ai(
                &settings.base_url,
                &settings.model,
                &api_key,
                app_name,
                target.host.as_deref(),
                target.title.as_deref(),
                timeout,
            )
            .map_err(ai_error)?;

            self.apply_ai_result_inner(&target, &settings.provider, &settings.model, ai_result)
        }

        /// Collect everything needed for an AI call without making it.
        /// Returns None if AI is disabled, already cached, or no target could be determined.
        pub fn prepare_ai_request(
            &self,
            app_name: &str,
            window_title: &Option<String>,
        ) -> Result<Option<AiPendingRequest>> {
            let local = self.classify_app(app_name)?;
            let Some(target) = ai_target(app_name, window_title, &local) else {
                return Ok(None);
            };

            if (target.kind == "youtube_title" || target.kind == "page_title")
                && self.find_ai_classification(&target.hash)?.is_some()
            {
                return Ok(None); // Already cached
            }

            let settings = self.deepseek_settings()?;
            if !settings.enabled {
                return Ok(None);
            }
            let Some(encrypted_api_key) = settings.encrypted_api_key.as_ref() else {
                return Ok(None);
            };
            let api_key = LocalVault::decrypt_secret(encrypted_api_key).map_err(ai_error)?;

            Ok(Some(AiPendingRequest {
                target_kind: target.kind,
                target_hash: target.hash,
                app_name: target.app_name,
                prefix: target.prefix,
                host: target.host,
                title: target.title,
                fallback_display_name: target.fallback_display_name,
                base_url: settings.base_url,
                model: settings.model,
                api_key,
                provider: settings.provider,
            }))
        }

        /// Persist the result of an AI call that was made outside the DB lock.
        pub fn save_ai_result(
            &self,
            request: &AiPendingRequest,
            ai_result: crate::ai::classifier::AiClassificationResult,
        ) -> Result<ClassifiedApp> {
            let target = AiTarget {
                kind: request.target_kind.clone(),
                hash: request.target_hash.clone(),
                app_name: request.app_name.clone(),
                prefix: request.prefix.clone(),
                host: request.host.clone(),
                title: request.title.clone(),
                fallback_display_name: request.fallback_display_name.clone(),
            };
            self.apply_ai_result_inner(&target, &request.provider, &request.model, ai_result)
        }

        fn apply_ai_result_inner(
            &self,
            target: &AiTarget,
            provider: &str,
            model: &str,
            ai_result: crate::ai::classifier::AiClassificationResult,
        ) -> Result<ClassifiedApp> {
            let category = normalize_ai_category(&ai_result.category).ok_or_else(|| {
                ai_error(format!(
                    "AI returned unsupported category '{}'",
                    ai_result.category
                ))
            })?;
            let display_name = if ai_result.display_name.trim().is_empty() {
                target.fallback_display_name.clone()
            } else {
                ai_result.display_name.trim().to_string()
            };

            if target.kind == "youtube_title" || target.kind == "page_title" {
                // Per-title result: store in ai_classifications keyed by title hash.
                // The same domain can be learning one day and entertainment the next,
                // so we never overwrite a host-level rule with a per-page decision.
                let classification = AiClassification {
                    context_hash: target.hash.clone(),
                    target_kind: target.kind.clone(),
                    app_name: target.app_name.clone(),
                    host: target.host.clone(),
                    title: target.title.clone(),
                    display_name: display_name.clone(),
                    category: category.clone(),
                    provider: provider.to_string(),
                    model: model.to_string(),
                };
                self.upsert_ai_classification(&classification)?;
            } else {
                let match_kind = if target.kind == "host" { "host" } else { "exact" };
                let token = if target.kind == "host" {
                    target.host.as_deref().unwrap_or(&target.app_name).to_string()
                } else {
                    normalize_token(&target.app_name)
                };
                self.upsert_ai_rule(&token, &display_name, &category, match_kind)?;
            }

            Ok(ClassifiedApp {
                display_name: if let Some(prefix) = target.prefix.as_ref() {
                    format!("{}: {}", prefix, display_name)
                } else {
                    display_name
                },
                category,
            })
        }

        pub fn get_ai_settings(&self) -> Result<AiSettings> {
            let settings = self.deepseek_settings()?;

            Ok(AiSettings {
                enabled: settings.enabled,
                provider: settings.provider,
                model: settings.model,
                base_url: settings.base_url,
                has_api_key: settings.encrypted_api_key.is_some(),
            })
        }

        pub fn ai_request_config(&self) -> Result<Option<AiRequestConfig>> {
            let settings = self.deepseek_settings()?;
            if !settings.enabled {
                return Ok(None);
            }

            let Some(encrypted_api_key) = settings.encrypted_api_key.as_ref() else {
                return Ok(None);
            };
            let api_key = LocalVault::decrypt_secret(encrypted_api_key)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;

            Ok(Some(AiRequestConfig {
                model: settings.model,
                base_url: settings.base_url,
                api_key,
            }))
        }

        pub fn set_ai_settings(
            &self,
            enabled: bool,
            api_key: Option<&str>,
            provider: Option<&str>,
            model: Option<&str>,
            base_url: Option<&str>,
        ) -> Result<()> {
            let encrypted_api_key = api_key
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(LocalVault::encrypt_secret)
                .transpose()
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;

            // If provider/model/base_url supplied, use them; otherwise keep existing values
            let has_config = provider.is_some() || model.is_some() || base_url.is_some();

            if let Some(encrypted_api_key) = encrypted_api_key {
                if has_config {
                    self.connection.execute(
                        "
                        UPDATE ai_settings
                        SET enabled = ?1,
                            provider = COALESCE(?2, provider),
                            model = COALESCE(?3, model),
                            base_url = COALESCE(?4, base_url),
                            encrypted_api_key = ?5,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1
                        ",
                        params![
                            enabled as u8,
                            provider,
                            model,
                            base_url,
                            encrypted_api_key
                        ],
                    )?;
                } else {
                    self.connection.execute(
                        "
                        UPDATE ai_settings
                        SET enabled = ?1,
                            encrypted_api_key = ?2,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1
                        ",
                        params![enabled as u8, encrypted_api_key],
                    )?;
                }
            } else if has_config {
                self.connection.execute(
                    "
                    UPDATE ai_settings
                    SET enabled = ?1,
                        provider = COALESCE(?2, provider),
                        model = COALESCE(?3, model),
                        base_url = COALESCE(?4, base_url),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                    ",
                    params![enabled as u8, provider, model, base_url],
                )?;
            } else {
                self.connection.execute(
                    "
                    UPDATE ai_settings
                    SET enabled = ?1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                    ",
                    params![enabled as u8],
                )?;
            }

            Ok(())
        }

        pub fn list_rules(&self) -> Result<Vec<ClassificationRule>> {
            let mut statement = self.connection.prepare(
                "
                SELECT token, display_name, category, match_kind, priority, source
                FROM classification_rules
                ORDER BY priority ASC, token ASC
                ",
            )?;

            let rules = statement
                .query_map([], map_rule)?
                .collect::<Result<Vec<_>>>()?;

            Ok(rules)
        }

        pub fn add_rule(
            &self,
            token: &str,
            display_name: &str,
            category: &str,
            match_kind: &str,
        ) -> Result<()> {
            let normalized = token.trim().to_lowercase();
            // A custom user rule has priority 50 by default, so it takes precedence over seeded defaults
            self.connection.execute(
                "
                INSERT OR REPLACE INTO classification_rules (
                    token,
                    display_name,
                    category,
                    match_kind,
                    priority,
                    source
                ) VALUES (?1, ?2, ?3, ?4, 50, 'user')
                ",
                params![
                    normalized,
                    display_name.trim(),
                    category.trim(),
                    match_kind.trim()
                ],
            )?;
            Ok(())
        }

        pub fn delete_rule(&self, token: &str) -> Result<()> {
            let normalized = token.trim().to_lowercase();
            self.connection.execute(
                "DELETE FROM classification_rules WHERE token = ?1",
                params![normalized],
            )?;
            Ok(())
        }

        pub fn reclassify_all_events(&self) -> Result<()> {
            let rules = self.list_rules()?;

            let mut select_stmt = self
                .connection
                .prepare("SELECT id, app_name, category FROM attention_events WHERE is_idle = 0")?;

            struct RawEvent {
                id: String,
                app_name: String,
                category: String,
            }

            let events = select_stmt
                .query_map([], |row| {
                    Ok(RawEvent {
                        id: row.get(0)?,
                        app_name: row.get(1)?,
                        category: row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>>>()?;

            let mut update_stmt = self.connection.prepare(
                "UPDATE attention_events SET app_name = ?1, category = ?2 WHERE id = ?3",
            )?;

            for event in events {
                let mut new_app_name = event.app_name.clone();
                let new_category;

                if let Some((prefix, context)) = event.app_name.split_once(": ") {
                    let matched_rule = rules.iter().find(|r| {
                        let normalized_ctx = context.trim().to_lowercase();
                        normalized_ctx == r.token
                            || normalized_ctx.ends_with(&format!(".{}", r.token))
                            || context.trim() == r.display_name
                    });

                    if let Some(rule) = matched_rule {
                        new_app_name = format!("{}: {}", prefix.trim(), rule.display_name);
                        new_category = rule.category.clone();
                    } else {
                        new_app_name = event.app_name.clone();
                        new_category = "browser".to_string();
                    }
                } else {
                    let normalized_app = event.app_name.trim().to_lowercase();
                    if normalized_app.starts_with("terminal:")
                        || normalized_app.starts_with("iterm2:")
                    {
                        new_app_name = event.app_name.clone();
                        new_category = "development".to_string();
                    } else {
                        let matched_rule = rules.iter().find(|r| {
                            normalized_app == r.token || event.app_name.trim() == r.display_name
                        });

                        if let Some(rule) = matched_rule {
                            new_app_name = rule.display_name.clone();
                            new_category = rule.category.clone();
                        } else {
                            new_category = "unknown".to_string();
                        }
                    }
                }

                if new_app_name != event.app_name || new_category != event.category {
                    update_stmt.execute(params![new_app_name, new_category, event.id])?;
                }
            }

            Ok(())
        }

        fn find_rule(&self, value: &str) -> Result<Option<ClassificationRule>> {
            let normalized = normalize_token(value);
            if normalized.is_empty() {
                return Ok(None);
            }

            if let Some(rule) = self.find_exact_rule(&normalized)? {
                return Ok(Some(rule));
            }

            self.find_host_rule(&normalized)
        }

        fn deepseek_settings(&self) -> Result<StoredAiSettings> {
            self.connection.query_row(
                "
                SELECT enabled, provider, model, base_url, encrypted_api_key
                FROM ai_settings
                WHERE id = 1
                ",
                [],
                |row| {
                    Ok(StoredAiSettings {
                        enabled: row.get::<_, u8>(0)? == 1,
                        provider: row.get(1)?,
                        model: row.get(2)?,
                        base_url: row.get(3)?,
                        encrypted_api_key: row.get(4)?,
                    })
                },
            )
        }

        fn find_ai_classification(&self, context_hash: &str) -> Result<Option<AiClassification>> {
            self.connection
                .query_row(
                    "
                    SELECT context_hash, target_kind, app_name, host, title, display_name, category, provider, model
                    FROM ai_classifications
                    WHERE context_hash = ?1
                    ",
                    params![context_hash],
                    |row| {
                        Ok(AiClassification {
                            context_hash: row.get(0)?,
                            target_kind: row.get(1)?,
                            app_name: row.get(2)?,
                            host: row.get(3)?,
                            title: row.get(4)?,
                            display_name: row.get(5)?,
                            category: row.get(6)?,
                            provider: row.get(7)?,
                            model: row.get(8)?,
                        })
                    },
                )
                .optional()
        }

        fn upsert_ai_classification(&self, classification: &AiClassification) -> Result<()> {
            self.connection.execute(
                "
                INSERT INTO ai_classifications (
                    context_hash,
                    target_kind,
                    app_name,
                    host,
                    title,
                    display_name,
                    category,
                    provider,
                    model
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(context_hash) DO UPDATE SET
                    display_name = excluded.display_name,
                    category = excluded.category,
                    provider = excluded.provider,
                    model = excluded.model,
                    updated_at = CURRENT_TIMESTAMP
                ",
                params![
                    classification.context_hash,
                    classification.target_kind,
                    classification.app_name,
                    classification.host,
                    classification.title,
                    classification.display_name,
                    classification.category,
                    classification.provider,
                    classification.model
                ],
            )?;
            Ok(())
        }

        fn upsert_ai_rule(
            &self,
            token: &str,
            display_name: &str,
            category: &str,
            match_kind: &str,
        ) -> Result<()> {
            self.connection.execute(
                "
                INSERT INTO classification_rules (token, display_name, category, match_kind, priority, source)
                VALUES (?1, ?2, ?3, ?4, 20, 'ai')
                ON CONFLICT(token) DO UPDATE SET
                    display_name = excluded.display_name,
                    category = excluded.category,
                    priority = excluded.priority
                WHERE source != 'user'
                ",
                params![token, display_name.trim(), category.trim(), match_kind],
            )?;
            Ok(())
        }

        fn find_exact_rule(&self, normalized: &str) -> Result<Option<ClassificationRule>> {
            self.connection
                .query_row(
                    "
                    SELECT token, display_name, category, match_kind, priority, source
                    FROM classification_rules
                    WHERE token = ?1 AND match_kind = 'exact'
                    ORDER BY priority ASC
                    LIMIT 1
                    ",
                    params![normalized],
                    map_rule,
                )
                .optional()
        }

        fn find_host_rule(&self, normalized: &str) -> Result<Option<ClassificationRule>> {
            let mut statement = self.connection.prepare(
                "
                SELECT token, display_name, category, match_kind, priority, source
                FROM classification_rules
                WHERE match_kind = 'host'
                ORDER BY priority ASC, length(token) DESC
                ",
            )?;
            let rules = statement
                .query_map([], map_rule)?
                .collect::<Result<Vec<_>>>()?;

            Ok(rules.into_iter().find(|rule| {
                normalized == rule.token || normalized.ends_with(&format!(".{}", rule.token))
            }))
        }
    }

    fn map_rule(row: &rusqlite::Row<'_>) -> Result<ClassificationRule> {
        Ok(ClassificationRule {
            token: row.get(0)?,
            display_name: row.get(1)?,
            category: row.get(2)?,
            match_kind: row.get(3)?,
            priority: row.get(4)?,
            source: row.get(5)?,
        })
    }

    fn normalize_token(value: &str) -> String {
        value
            .trim()
            .trim_start_matches("www.")
            .trim_end_matches('.')
            .to_lowercase()
    }

    fn ai_target(
        app_name: &str,
        window_title: &Option<String>,
        local: &ClassifiedApp,
    ) -> Option<AiTarget> {
        let title = window_title
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        if let Some((prefix, context)) = app_name.split_once(": ") {
            let host = normalize_token(context);
            if host.is_empty() {
                return None;
            }

            if is_youtube_host(&host) {
                let title = title?;
                let canonical = youtube_hash_host();
                return Some(AiTarget {
                    kind: "youtube_title".to_string(),
                    hash: context_hash("youtube_title", &[canonical, &title]),
                    app_name: app_name.trim().to_string(),
                    prefix: Some(prefix.trim().to_string()),
                    host: Some(canonical.to_string()),
                    title: Some(title),
                    fallback_display_name: "YouTube".to_string(),
                });
            }

            // For any browser site with a page title, classify per-title regardless of
            // whether a host-level seeded rule exists. The same domain can host learning
            // articles, entertainment streams, or social content depending on the page.
            if let Some(t) = title {
                return Some(AiTarget {
                    kind: "page_title".to_string(),
                    hash: context_hash("page_title", &[&host, &t]),
                    app_name: app_name.trim().to_string(),
                    prefix: Some(prefix.trim().to_string()),
                    host: Some(host.clone()),
                    title: Some(t),
                    fallback_display_name: host,
                });
            }

            // No title: only classify the host if it hasn't been categorised yet.
            if local.category != "unknown" && local.category != "browser" {
                return None;
            }

            return Some(AiTarget {
                kind: "host".to_string(),
                hash: context_hash("host", &[&host]),
                app_name: app_name.trim().to_string(),
                prefix: Some(prefix.trim().to_string()),
                host: Some(host.clone()),
                title: None,
                fallback_display_name: host,
            });
        }

        // Some browser platforms arrive as a display name (e.g. "YouTube") rather than
        // "Browser: host" because the tracker already resolved the host to its display name.
        // This table maps each known normalised display-name alias to (canonical_host, display_name)
        // so per-title AI classification still runs for those platforms.
        const PLATFORM_ALIASES: &[(&str, &str, &str)] = &[
            ("youtube",  "youtube.com", "YouTube"),
            ("youtu.be", "youtube.com", "YouTube"),
        ];
        let normalized = normalize_token(app_name);
        if let Some(&(_, host_str, display_name)) = PLATFORM_ALIASES.iter().find(|(alias, _, _)| *alias == normalized) {
            let title = title?;
            let host = host_str.to_string();
            return Some(AiTarget {
                kind: "youtube_title".to_string(),
                hash: context_hash("youtube_title", &[&host, &title]),
                app_name: app_name.trim().to_string(),
                prefix: None,
                host: Some(host),
                title: Some(title),
                fallback_display_name: display_name.to_string(),
            });
        }

        if local.category != "unknown" {
            return None;
        }

        if normalized.is_empty() {
            return None;
        }

        Some(AiTarget {
            kind: "app".to_string(),
            hash: context_hash("app", &[&normalized]),
            app_name: app_name.trim().to_string(),
            prefix: None,
            host: None,
            title,
            fallback_display_name: app_name.trim().to_string(),
        })
    }

    fn classified_from_ai(target: &AiTarget, classification: &AiClassification) -> ClassifiedApp {
        let display_name = if let Some(prefix) = target.prefix.as_ref() {
            format!("{}: {}", prefix, classification.display_name)
        } else {
            classification.display_name.clone()
        };

        ClassifiedApp {
            display_name,
            category: classification.category.clone(),
        }
    }

    fn context_hash(kind: &str, values: &[&str]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(kind.as_bytes());
        for value in values {
            hasher.update([0]);
            hasher.update(value.trim().to_lowercase().as_bytes());
        }
        format!("{:x}", hasher.finalize())
    }

    fn is_youtube_host(host: &str) -> bool {
        // "youtube" matches when the display name ("YouTube") was normalised instead of the raw domain
        host == "youtube.com" || host.ends_with(".youtube.com") || host == "youtu.be" || host == "youtube"
    }

    /// Canonical host key used for youtube_title cache hashes.
    /// Always "youtube.com" regardless of whether the input was a domain or display name.
    fn youtube_hash_host() -> &'static str {
        "youtube.com"
    }

    fn normalize_ai_category(category: &str) -> Option<String> {
        match category.trim().to_lowercase().as_str() {
            "development" | "communication" | "learning" | "productivity"
            | "browser" | "entertainment" | "social" | "system" | "unknown" => {
                Some(category.trim().to_lowercase())
            }
            // design was merged into productivity
            "design" => Some("productivity".to_string()),
            _ => None,
        }
    }

    fn ai_error(message: impl Into<String>) -> rusqlite::Error {
        rusqlite::Error::ToSqlConversionFailure(
            std::io::Error::new(std::io::ErrorKind::Other, message.into()).into(),
        )
    }

    #[cfg(test)]
    mod tests {
        use rusqlite::Connection;

        use super::ClassificationRepository;
        use crate::database::migrations::run_migrations;

        #[test]
        fn classifies_browser_hosts_from_seeded_rules() {
            let connection = Connection::open_in_memory().expect("in-memory database");
            run_migrations(&connection).expect("migrations");
            let repository = ClassificationRepository::new(&connection);

            let classified = repository
                .classify_app("Google Chrome: netflix.com")
                .expect("classification");

            assert_eq!(classified.display_name, "Google Chrome: Netflix");
            assert_eq!(classified.category, "entertainment");
        }

        #[test]
        fn classifies_browser_social_hosts_from_subdomains() {
            let connection = Connection::open_in_memory().expect("in-memory database");
            run_migrations(&connection).expect("migrations");
            let repository = ClassificationRepository::new(&connection);

            let classified = repository
                .classify_app("Arc: www.instagram.com")
                .expect("classification");

            assert_eq!(classified.display_name, "Arc: Instagram");
            assert_eq!(classified.category, "social");
        }
    }
}

pub mod daily_summaries {
    use rusqlite::{params, Connection, OptionalExtension, Result};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct DailySummary {
        pub local_date: String,
        pub timezone: String,
        pub summary: String,
        pub main_drift_story: String,
        pub improvement_tip: String,
        pub time_wasters: Vec<String>,
        pub main_distractions: Vec<String>,
        pub focus_seconds: u64,
        pub learning_seconds: u64,
        pub drift_seconds: u64,
        pub longest_focus_seconds: u64,
        pub model: String,
        pub generated_at: String,
    }

    pub struct DailySummaryRepository<'a> {
        connection: &'a Connection,
    }

    impl<'a> DailySummaryRepository<'a> {
        pub fn new(connection: &'a Connection) -> Self {
            Self { connection }
        }

        pub fn find(&self, local_date: &str) -> Result<Option<DailySummary>> {
            self.connection
                .query_row(
                    "
                    SELECT local_date, timezone, summary, main_drift_story, improvement_tip,
                           focus_seconds, learning_seconds, drift_seconds, model, generated_at,
                           COALESCE(time_wasters, '[]'), COALESCE(main_distractions, '[]'),
                           COALESCE(longest_focus_seconds, 0)
                    FROM daily_summaries
                    WHERE local_date = ?1
                    ",
                    params![local_date],
                    map_summary,
                )
                .optional()
        }

        pub fn upsert(&self, summary: &DailySummary) -> Result<()> {
            let time_wasters_json = serde_json::to_string(&summary.time_wasters).unwrap_or_else(|_| "[]".to_string());
            let main_distractions_json = serde_json::to_string(&summary.main_distractions).unwrap_or_else(|_| "[]".to_string());
            self.connection.execute(
                "
                INSERT INTO daily_summaries (
                    local_date,
                    timezone,
                    summary,
                    main_drift_story,
                    improvement_tip,
                    time_wasters,
                    main_distractions,
                    focus_seconds,
                    learning_seconds,
                    drift_seconds,
                    longest_focus_seconds,
                    model,
                    generated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
                ON CONFLICT(local_date) DO UPDATE SET
                    timezone = excluded.timezone,
                    summary = excluded.summary,
                    main_drift_story = excluded.main_drift_story,
                    improvement_tip = excluded.improvement_tip,
                    time_wasters = excluded.time_wasters,
                    main_distractions = excluded.main_distractions,
                    focus_seconds = excluded.focus_seconds,
                    learning_seconds = excluded.learning_seconds,
                    drift_seconds = excluded.drift_seconds,
                    longest_focus_seconds = excluded.longest_focus_seconds,
                    model = excluded.model,
                    generated_at = CURRENT_TIMESTAMP
                ",
                params![
                    summary.local_date,
                    summary.timezone,
                    summary.summary,
                    summary.main_drift_story,
                    summary.improvement_tip,
                    time_wasters_json,
                    main_distractions_json,
                    summary.focus_seconds,
                    summary.learning_seconds,
                    summary.drift_seconds,
                    summary.longest_focus_seconds,
                    summary.model
                ],
            )?;

            Ok(())
        }

        pub fn delete(&self, local_date: &str) -> Result<()> {
            self.connection.execute(
                "DELETE FROM daily_summaries WHERE local_date = ?1",
                params![local_date],
            )?;
            Ok(())
        }
    }

    fn map_summary(row: &rusqlite::Row<'_>) -> Result<DailySummary> {
        let time_wasters_json: String = row.get(10).unwrap_or_else(|_| "[]".to_string());
        let main_distractions_json: String = row.get(11).unwrap_or_else(|_| "[]".to_string());
        Ok(DailySummary {
            local_date: row.get(0)?,
            timezone: row.get(1)?,
            summary: row.get(2)?,
            main_drift_story: row.get(3)?,
            improvement_tip: row.get(4)?,
            focus_seconds: row.get(5)?,
            learning_seconds: row.get(6)?,
            drift_seconds: row.get(7)?,
            model: row.get(8)?,
            generated_at: row.get(9)?,
            time_wasters: serde_json::from_str(&time_wasters_json).unwrap_or_default(),
            main_distractions: serde_json::from_str(&main_distractions_json).unwrap_or_default(),
            longest_focus_seconds: row.get(12).unwrap_or(0),
        })
    }
}

pub mod hourly_summaries {
    use rusqlite::{params, Connection, Result};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct HourlySummary {
        pub local_date: String,
        pub hour: u8,
        pub summary: String,
        pub main_drift_story: String,
        pub improvement_tip: String,
        pub focus_seconds: u64,
        pub learning_seconds: u64,
        pub drift_seconds: u64,
        pub model: String,
    }

    pub struct HourlySummaryRepository<'a> {
        connection: &'a Connection,
    }

    impl<'a> HourlySummaryRepository<'a> {
        pub fn new(connection: &'a Connection) -> Self {
            Self { connection }
        }

        pub fn list_for_date(&self, local_date: &str) -> Result<Vec<HourlySummary>> {
            let mut stmt = self.connection.prepare(
                "SELECT local_date, hour, summary, main_drift_story, improvement_tip,
                        focus_seconds, learning_seconds, drift_seconds, model
                 FROM hourly_summaries
                 WHERE local_date = ?1
                 ORDER BY hour ASC",
            )?;
            let rows = stmt.query_map(params![local_date], map_row)?;
            rows.collect()
        }

        pub fn upsert(&self, summary: &HourlySummary) -> Result<()> {
            self.connection.execute(
                "INSERT INTO hourly_summaries (
                    local_date, hour, summary, main_drift_story, improvement_tip,
                    focus_seconds, learning_seconds, drift_seconds, model, generated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
                 ON CONFLICT(local_date, hour) DO UPDATE SET
                    summary          = excluded.summary,
                    main_drift_story = excluded.main_drift_story,
                    improvement_tip  = excluded.improvement_tip,
                    focus_seconds    = excluded.focus_seconds,
                    learning_seconds = excluded.learning_seconds,
                    drift_seconds    = excluded.drift_seconds,
                    model            = excluded.model,
                    generated_at     = CURRENT_TIMESTAMP",
                params![
                    summary.local_date,
                    summary.hour,
                    summary.summary,
                    summary.main_drift_story,
                    summary.improvement_tip,
                    summary.focus_seconds,
                    summary.learning_seconds,
                    summary.drift_seconds,
                    summary.model,
                ],
            )?;
            Ok(())
        }
    }

    fn map_row(row: &rusqlite::Row<'_>) -> Result<HourlySummary> {
        Ok(HourlySummary {
            local_date: row.get(0)?,
            hour: row.get(1)?,
            summary: row.get(2)?,
            main_drift_story: row.get(3)?,
            improvement_tip: row.get(4)?,
            focus_seconds: row.get(5)?,
            learning_seconds: row.get(6)?,
            drift_seconds: row.get(7)?,
            model: row.get(8)?,
        })
    }
}
