import { useEffect, useState } from "react";
import { ClassificationSettings } from "./components/ClassificationSettings";
import { DataPortabilityPanel } from "./components/DataPortabilityPanel";
import { InsightEnginePanel } from "./components/InsightEnginePanel";
import { PermissionsPanel } from "./components/PermissionsPanel";
import { TrackingPanel } from "./components/TrackingPanel";
import { UpdateModal } from "@/features/update/UpdateModal";
import { getAppVersion } from "@/shared/api/systemApi";

export function SettingsView() {
  const [permRefreshKey, setPermRefreshKey] = useState(0);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => undefined);
  }, []);

  return (
    <div className="view-stack">
      <UpdateModal />
      <header className="view-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 style={{ margin: 0 }}>Privacy controls</h1>
          {version && (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--color-text-soft)",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--color-border)",
              borderRadius: 20,
              padding: "2px 8px",
              lineHeight: 1.4,
              letterSpacing: "0.01em",
            }}>
              v{version}
            </span>
          )}
        </div>
        <p>Flint stores data locally and avoids surveillance features by design.</p>
      </header>

      <section className="settings-list">
        <PermissionsPanel refreshKey={permRefreshKey} />
        <ClassificationSettings />
        <InsightEnginePanel />
        <TrackingPanel onPermissionsChange={() => setPermRefreshKey((k) => k + 1)} />
        <DataPortabilityPanel />
      </section>

    </div>
  );
}
