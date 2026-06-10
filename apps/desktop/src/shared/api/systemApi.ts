import type { AttentionEvent } from "@flint/domain";
import { callTauri, isTauriRuntime } from "./tauriClient";
import { localDayRange, localDateKey } from "./eventsApi";

export type DetectionSnapshot = {
  rawAppName?: string;
  enrichedAppName?: string;
  windowTitle?: string;
  category?: AttentionEvent["category"];
  isIdle: boolean;
  idleSeconds: number;
  contextAwarenessEnabled: boolean;
  privateModeEnabled: boolean;
  status: string;
  browserStatus?: string;
  browserDiagnostic?: string;
};

export type HomeAttentionSection = {
  label: string;
  summary: string;
  focusSeconds: number;
  learningSeconds: number;
  driftSeconds: number;
  idleSeconds: number;
  longestFocusSeconds: number;
  topCategories: Array<{ category: string; seconds: number }>;
  whatWasOff: string;
  timeWasters: string[];
  mainDistractions: string[];
  tip: string;
  generatedWithAi: boolean;
  error?: string;
};

export type HomeAttentionNarratives = {
  today: HomeAttentionSection;
  previousDay: HomeAttentionSection;
};

export type ClassificationRule = {
  token: string;
  displayName: string;
  category: string;
  matchKind: string;
  priority: number;
  source: "seed" | "user";
};

export type BrowserPermissionResult = {
  supportedBrowser: boolean;
  browserName?: string;
  /** "ready" | "automation_denied" | "not_running" | "no_window" | "no_url" | "not_browser" | "script_error" | "unsupported" */
  status: string;
  detail: string;
  remediation: string;
};

type RustDetectionSnapshot = {
  raw_app_name?: string;
  enriched_app_name?: string;
  window_title?: string;
  category?: AttentionEvent["category"];
  is_idle: boolean;
  idle_seconds: number;
  context_awareness_enabled: boolean;
  private_mode_enabled: boolean;
  status: string;
  browser_status?: string;
  browser_diagnostic?: string;
};

type RustHomeAttentionSection = {
  label: string;
  summary: string;
  focus_seconds: number;
  learning_seconds: number;
  drift_seconds: number;
  idle_seconds: number;
  longest_focus_seconds: number;
  top_categories: Array<{ category: string; seconds: number }>;
  what_was_off: string;
  time_wasters: string[];
  main_distractions: string[];
  tip: string;
  generated_with_ai: boolean;
  error?: string;
};

type RustHomeAttentionNarratives = {
  today: RustHomeAttentionSection;
  previous_day: RustHomeAttentionSection;
};

type RustClassificationRule = {
  token: string;
  display_name: string;
  category: string;
  match_kind: string;
  priority: number;
  source: string;
};

type RustBrowserPermissionResult = {
  supported_browser: boolean;
  browser_name?: string;
  status: string;
  detail: string;
  remediation: string;
};

export async function getCurrentDetectionSnapshot() {
  if (!isTauriRuntime()) {
    return {
      rawAppName: "Browser Preview",
      enrichedAppName: "Browser Preview",
      category: "browser",
      isIdle: false,
      idleSeconds: 0,
      contextAwarenessEnabled: false,
      privateModeEnabled: false,
      status: "preview",
      browserStatus: "preview",
      browserDiagnostic: "Browser diagnostics are available in the desktop app.",
    } satisfies DetectionSnapshot;
  }
  return fromRustDetectionSnapshot(
    await callTauri<RustDetectionSnapshot>("get_current_detection_snapshot"),
  );
}

export async function getHomeAttentionNarratives(now = new Date()): Promise<HomeAttentionNarratives> {
  const today = localDayRange(now);
  const previousStart = new Date(today.start);
  previousStart.setDate(previousStart.getDate() - 1);
  const previousEnd = new Date(today.start);
  const previousLocalDate = localDateKey(previousStart);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  if (!isTauriRuntime()) {
    return {
      today: previewHomeSection("Today so far"),
      previousDay: previewHomeSection("Previous day"),
    };
  }

  return fromRustHomeAttentionNarratives(
    await callTauri<RustHomeAttentionNarratives>("get_home_attention_narratives", {
      todayStartAt: today.start.toISOString(),
      todayEndAt: today.end.toISOString(),
      currentHour: now.getHours(),
      localDate: localDateKey(now),
      previousStartAt: previousStart.toISOString(),
      previousEndAt: previousEnd.toISOString(),
      previousLocalDate,
      timezone,
    }),
  );
}

export async function listClassificationRules(): Promise<ClassificationRule[]> {
  if (!isTauriRuntime()) {
    return [
      { token: "spotify", displayName: "Spotify", category: "entertainment", matchKind: "exact", priority: 100, source: "seed" },
      { token: "netflix.com", displayName: "Netflix", category: "entertainment", matchKind: "host", priority: 100, source: "seed" },
      { token: "youtube.com", displayName: "YouTube", category: "entertainment", matchKind: "host", priority: 100, source: "seed" },
    ];
  }
  const rules = await callTauri<RustClassificationRule[]>("list_classification_rules");
  return rules.map((r) => ({
    token: r.token,
    displayName: r.display_name,
    category: r.category,
    matchKind: r.match_kind,
    priority: r.priority,
    source: r.source as "seed" | "user",
  }));
}

export async function addClassificationRule(token: string, displayName: string, category: string, matchKind: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("add_classification_rule", { token, displayName, category, matchKind });
}

export async function deleteClassificationRule(token: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("delete_classification_rule", { token });
}

export async function toggleWindowCompact(compact: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("toggle_window_compact", { compact });
}

export async function exportBackup(): Promise<{ path: string; key: string }> {
  if (!isTauriRuntime()) throw new Error("Backup export is only available in the desktop app.");
  return callTauri<{ path: string; key: string }>("export_backup");
}

export async function pickBackupFile(): Promise<string | null> {
  if (!isTauriRuntime()) throw new Error("File picker is only available in the desktop app.");
  return callTauri<string | null>("pick_backup_file");
}

export async function importBackup(path: string, password?: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error("Backup import is only available in the desktop app.");
  await callTauri<void>("import_backup", { path, password: password ?? null });
}

export async function checkBrowserPermission(browserName: string): Promise<BrowserPermissionResult> {
  if (!isTauriRuntime()) {
    return { supportedBrowser: false, status: "unsupported", detail: "Desktop only.", remediation: "" };
  }
  const r = await callTauri<RustBrowserPermissionResult>("check_browser_permission", { browserName });
  return { supportedBrowser: r.supported_browser, browserName: r.browser_name, status: r.status, detail: r.detail, remediation: r.remediation };
}

export async function requestAccessibilityPermission(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return callTauri<boolean>("request_accessibility_permission");
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("open_accessibility_settings");
}

export async function openAutomationSettings(): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("open_automation_settings");
}

export async function saveCardImage(path: string, dataUrl: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("save_card_image", { path, dataUrl });
}

export async function resetApp(): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("reset_app");
}

export type UpdateInfo = { version: string; url: string };

export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return "dev";
  return callTauri<string>("get_app_version");
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauriRuntime()) return null;
  return callTauri<UpdateInfo | null>("check_for_update");
}

export async function openUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) { window.open(url, "_blank"); return; }
  await callTauri<void>("open_url", { url });
}

function fromRustDetectionSnapshot(snapshot: RustDetectionSnapshot): DetectionSnapshot {
  return {
    rawAppName: snapshot.raw_app_name,
    enrichedAppName: snapshot.enriched_app_name,
    windowTitle: snapshot.window_title,
    category: snapshot.category,
    isIdle: snapshot.is_idle,
    idleSeconds: snapshot.idle_seconds,
    contextAwarenessEnabled: snapshot.context_awareness_enabled,
    privateModeEnabled: snapshot.private_mode_enabled,
    status: snapshot.status,
    browserStatus: snapshot.browser_status,
    browserDiagnostic: snapshot.browser_diagnostic,
  };
}

function fromRustHomeAttentionNarratives(narratives: RustHomeAttentionNarratives): HomeAttentionNarratives {
  return {
    today: fromRustHomeAttentionSection(narratives.today),
    previousDay: fromRustHomeAttentionSection(narratives.previous_day),
  };
}

function fromRustHomeAttentionSection(section: RustHomeAttentionSection): HomeAttentionSection {
  return {
    label: section.label,
    summary: section.summary,
    focusSeconds: section.focus_seconds,
    learningSeconds: section.learning_seconds,
    driftSeconds: section.drift_seconds,
    idleSeconds: section.idle_seconds,
    longestFocusSeconds: section.longest_focus_seconds ?? 0,
    topCategories: section.top_categories,
    whatWasOff: section.what_was_off,
    timeWasters: section.time_wasters ?? [],
    mainDistractions: section.main_distractions ?? [],
    tip: section.tip,
    generatedWithAi: section.generated_with_ai,
    error: section.error,
  };
}

function previewHomeSection(label: string): HomeAttentionSection {
  return {
    label,
    summary: "AI attention summaries are available in the desktop app.",
    focusSeconds: 0,
    learningSeconds: 0,
    driftSeconds: 0,
    idleSeconds: 0,
    longestFocusSeconds: 0,
    topCategories: [],
    whatWasOff: "",
    timeWasters: [],
    mainDistractions: [],
    tip: "Run the desktop app to generate summaries from local data.",
    generatedWithAi: false,
  };
}
