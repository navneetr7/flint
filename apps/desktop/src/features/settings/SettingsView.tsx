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
        <h1>Privacy controls</h1>
        <p>Flint stores data locally and avoids surveillance features by design.</p>
      </header>

      <section className="settings-list">
        <PermissionsPanel refreshKey={permRefreshKey} />
        <ClassificationSettings />
        <InsightEnginePanel />
        <TrackingPanel onPermissionsChange={() => setPermRefreshKey((k) => k + 1)} />
        <DataPortabilityPanel />
      </section>

      {version && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-muted)", paddingBottom: 4 }}>
          Flint v{version}
        </p>
      )}
    </div>
  );
}
