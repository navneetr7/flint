import { useState } from "react";
import { ClassificationSettings } from "./components/ClassificationSettings";
import { DataPortabilityPanel } from "./components/DataPortabilityPanel";
import { InsightEnginePanel } from "./components/InsightEnginePanel";
import { PermissionsPanel } from "./components/PermissionsPanel";
import { TrackingPanel } from "./components/TrackingPanel";
import { UpdateModal } from "@/features/update/UpdateModal";

export function SettingsView() {
  const [permRefreshKey, setPermRefreshKey] = useState(0);

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
    </div>
  );
}
