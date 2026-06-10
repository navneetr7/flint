import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addExcludedApp,
  getPrivacySettings,
  removeExcludedApp,
  setCollectWindowTitles,
  setIdleThresholdSeconds,
  setShowTrayLabel,
  type PrivacySettings,
} from "@/shared/api/attentionApi";

const EXCLUDED_ROW_LIMIT = 2;

type Props = {
  onPermissionsChange?: () => void;
};

export function TrackingPanel({ onPermissionsChange }: Props) {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [appName, setAppName] = useState("");
  const [idleDraft, setIdleDraft] = useState<string | null>(null);
  const [showAllExcluded, setShowAllExcluded] = useState(false);

  useEffect(() => {
    getPrivacySettings().then(setSettings).catch(() => undefined);
  }, []);

  async function handleContextAwarenessToggle() {
    const updated = await setCollectWindowTitles(!settings?.collectWindowTitles);
    setSettings(updated);
    onPermissionsChange?.();
  }

  async function handleTrayLabelToggle() {
    const updated = await setShowTrayLabel(!settings?.showTrayLabel);
    setSettings(updated);
  }

  async function handleIdleThresholdBlur() {
    const parsed = parseInt(idleDraft ?? "", 10);
    const committed = isNaN(parsed) || parsed < 1 ? 15 : parsed;
    setIdleDraft(null);
    const updated = await setIdleThresholdSeconds(committed);
    setSettings(updated);
  }

  async function handleAddExcludedApp() {
    if (!appName.trim()) return;
    const updated = await addExcludedApp(appName);
    setSettings(updated);
    setAppName("");
  }

  async function handleRemoveExcludedApp(excludedApp: string) {
    const updated = await removeExcludedApp(excludedApp);
    setSettings(updated);
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <div>
          <span className="section-kicker">Tracking</span>
          <h2>Behaviour & filters</h2>
        </div>
      </div>

      <div className="tracking-inline-row">
        <button className="tracking-toggle-btn" type="button" onClick={() => void handleContextAwarenessToggle()}>
          <span>Context awareness</span>
          <span className="toggle-track">
            <span className={settings?.collectWindowTitles ? "toggle-thumb toggle-thumb-on" : "toggle-thumb"} />
          </span>
        </button>
        <button className="tracking-toggle-btn" type="button" onClick={() => void handleTrayLabelToggle()}>
          <span>Dynamic Notifications</span>
          <span className="toggle-track">
            <span className={settings?.showTrayLabel ? "toggle-thumb toggle-thumb-on" : "toggle-thumb"} />
          </span>
        </button>
        <label className="tracking-inline-item">
          <span className="tracking-inline-label">Idle threshold</span>
          <span className="idle-value-wrap">
            <input
              aria-label="Idle threshold seconds"
              type="number"
              value={idleDraft ?? (settings?.idleThresholdSeconds ?? 600)}
              onChange={(e) => setIdleDraft(e.target.value)}
              onBlur={() => void handleIdleThresholdBlur()}
            />
            <span className="tracking-inline-unit">s</span>
          </span>
        </label>
        <div className="tracking-inline-item tracking-inline-exclude">
          <input
            aria-label="Excluded app name"
            placeholder="Exclude an app…"
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
          />
          <button type="button" onClick={() => void handleAddExcludedApp()}>Add</button>
        </div>
      </div>

      {settings?.excludedApps && settings.excludedApps.length > 0 && (
        <div className="excluded-apps-wrap">
          <div className="excluded-apps-pills">
            {(showAllExcluded ? settings.excludedApps : settings.excludedApps.slice(0, EXCLUDED_ROW_LIMIT * 4)).map((excludedApp) => (
              <button
                key={excludedApp}
                className="excluded-app-pill"
                type="button"
                onClick={() => void handleRemoveExcludedApp(excludedApp)}
              >
                <span>{excludedApp}</span>
                <X size={11} />
              </button>
            ))}
          </div>
          {settings.excludedApps.length > EXCLUDED_ROW_LIMIT * 4 && (
            <button
              className="show-more-btn"
              type="button"
              onClick={() => setShowAllExcluded((v) => !v)}
            >
              {showAllExcluded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
