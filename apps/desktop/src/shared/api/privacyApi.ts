import { callTauri, isTauriRuntime } from "./tauriClient";

export type PrivacySettings = {
  privateModeEnabled: boolean;
  collectWindowTitles: boolean;
  idleThresholdSeconds: number;
  excludedApps: string[];
  showTrayLabel: boolean;
  focusMilestoneTargetMinutes: number;
  onboardingCompleted: boolean;
};

export type PermissionStatus = {
  activeAppAccess: string;
  contextAwareness: string;
  storage: string;
};

type RustPrivacySettings = {
  private_mode_enabled: boolean;
  collect_window_titles: boolean;
  idle_threshold_seconds: number;
  excluded_apps: string[];
  show_tray_label: boolean;
  focus_milestone_target_minutes: number;
  onboarding_completed: boolean;
};

type RustPermissionStatus = {
  active_app_access: string;
  context_awareness: string;
  storage: string;
};

const defaultIdleThresholdSeconds = 10 * 60;

export const defaultPrivacySettings: PrivacySettings = {
  privateModeEnabled: false,
  collectWindowTitles: false,
  idleThresholdSeconds: defaultIdleThresholdSeconds,
  excludedApps: [],
  showTrayLabel: true,
  focusMilestoneTargetMinutes: 15,
  onboardingCompleted: false,
};

export async function getPrivacySettings() {
  if (!isTauriRuntime()) return defaultPrivacySettings;
  return fromRustPrivacySettings(await callTauri<RustPrivacySettings>("get_privacy_settings"));
}

export async function setPrivateMode(enabled: boolean) {
  if (!isTauriRuntime()) return { ...defaultPrivacySettings, privateModeEnabled: enabled };
  return fromRustPrivacySettings(await callTauri<RustPrivacySettings>("set_private_mode", { enabled }));
}

export async function setCollectWindowTitles(enabled: boolean) {
  if (!isTauriRuntime()) return { ...defaultPrivacySettings, collectWindowTitles: enabled };
  return fromRustPrivacySettings(
    await callTauri<RustPrivacySettings>("set_collect_window_titles", { enabled }),
  );
}

export async function setIdleThresholdSeconds(seconds: number) {
  if (!isTauriRuntime()) {
    return { ...defaultPrivacySettings, idleThresholdSeconds: Math.min(Math.max(seconds, 15), 900) };
  }
  return fromRustPrivacySettings(
    await callTauri<RustPrivacySettings>("set_idle_threshold_seconds", { seconds }),
  );
}

export async function setShowTrayLabel(enabled: boolean) {
  if (!isTauriRuntime()) return { ...defaultPrivacySettings, showTrayLabel: enabled };
  return fromRustPrivacySettings(
    await callTauri<RustPrivacySettings>("set_show_tray_label", { enabled }),
  );
}

export async function addExcludedApp(appName: string) {
  if (!isTauriRuntime()) return { ...defaultPrivacySettings, excludedApps: [appName] };
  return fromRustPrivacySettings(await callTauri<RustPrivacySettings>("add_excluded_app", { appName }));
}

export async function removeExcludedApp(appName: string) {
  if (!isTauriRuntime()) return defaultPrivacySettings;
  return fromRustPrivacySettings(
    await callTauri<RustPrivacySettings>("remove_excluded_app", { appName }),
  );
}

export async function getPermissionStatus() {
  if (!isTauriRuntime()) {
    return { activeAppAccess: "Browser Preview", contextAwareness: "Off", storage: "preview" };
  }
  return fromRustPermissionStatus(await callTauri<RustPermissionStatus>("get_permission_status"));
}

export async function isOnboardingCompleted(): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  return callTauri<boolean>("is_onboarding_completed");
}

export async function markOnboardingCompleted(): Promise<void> {
  if (!isTauriRuntime()) return;
  await callTauri<void>("mark_onboarding_completed");
}

function fromRustPrivacySettings(settings: RustPrivacySettings): PrivacySettings {
  return {
    privateModeEnabled: settings.private_mode_enabled,
    collectWindowTitles: settings.collect_window_titles,
    idleThresholdSeconds: settings.idle_threshold_seconds,
    excludedApps: settings.excluded_apps,
    showTrayLabel: settings.show_tray_label,
    focusMilestoneTargetMinutes: settings.focus_milestone_target_minutes,
    onboardingCompleted: settings.onboarding_completed,
  };
}

function fromRustPermissionStatus(status: RustPermissionStatus): PermissionStatus {
  return {
    activeAppAccess: status.active_app_access,
    contextAwareness: status.context_awareness,
    storage: status.storage,
  };
}
