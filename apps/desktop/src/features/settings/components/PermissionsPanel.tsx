import { useEffect, useState } from "react";
import { getPermissionStatus, type PermissionStatus } from "@/shared/api/attentionApi";
import { BrowserPermissionsWizard } from "./BrowserPermissionsWizard";

type Props = {
  refreshKey?: number;
};

function StatusBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-badge">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PermissionsPanel({ refreshKey }: Props) {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  useEffect(() => {
    getPermissionStatus().then(setPermissionStatus).catch(() => undefined);
  }, [refreshKey]);

  return (
    <>
      <div className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <span className="section-kicker">Permissions</span>
            <h2>On-device activity</h2>
          </div>
          <button
            className="settings-wizard-btn"
            type="button"
            onClick={() => setIsWizardOpen(true)}
          >
            Setup Wizard
          </button>
        </div>
        <div className="permission-grid">
          <StatusBadge label="Active app" value={permissionStatus?.activeAppAccess ?? "Checking"} />
          <StatusBadge label="Context" value={permissionStatus?.contextAwareness ?? "Checking"} />
        </div>
      </div>

      <BrowserPermissionsWizard
        isOpen={isWizardOpen}
        onClose={() => {
          setIsWizardOpen(false);
          getPermissionStatus().then(setPermissionStatus).catch(() => undefined);
        }}
      />
    </>
  );
}
