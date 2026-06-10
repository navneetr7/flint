import { useState } from "react";
import { clearAttentionEvents, exportBackup } from "@/shared/api/attentionApi";
import { useAppStore } from "@/shared/store/appStore";
import { ImportBackupModal } from "./ImportBackupModal";
import { ResetAppModal } from "./ResetAppModal";

export function DataPortabilityPanel() {
  const [dataToast, setDataToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const bumpAttentionRevision = useAppStore((state) => state.bumpAttentionRevision);

  function showDataToast(ok: boolean, message: string) {
    setDataToast({ ok, message });
    setTimeout(() => setDataToast(null), 10_000);
  }

  async function handleExportBackup() {
    setExportedKey(null);
    try {
      const result = await exportBackup();
      setExportedKey(result.key);
      showDataToast(true, `Backup saved to ${result.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showDataToast(false, message || "Export failed");
    }
  }

  async function handleClearLocalData() {
    await clearAttentionEvents();
    bumpAttentionRevision();
  }

  return (
    <>
      {dataToast && (
        <div className={`ai-test-toast ${dataToast.ok ? "ok" : "error"}`}>{dataToast.message}</div>
      )}

      <div className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <span className="section-kicker">Data portability</span>
            <h2>Encrypted backup</h2>
          </div>
        </div>
        <div className="data-actions-row">
          <button className="data-action-btn" type="button" onClick={() => void handleExportBackup()}>
            Export backup
          </button>
          <button className="data-action-btn" type="button" onClick={() => setIsImportOpen(true)}>
            Import backup
          </button>
          <button className="data-action-btn data-action-danger" type="button" onClick={() => void handleClearLocalData()}>
            Delete local data
          </button>
          <button className="data-action-btn data-action-danger" type="button" onClick={() => setIsResetOpen(true)}>
            Reset app
          </button>
        </div>
        {exportedKey ? (
          <div className="diagnostics-context">
            <span>Backup key — save this</span>
            <strong style={{ fontFamily: "monospace", letterSpacing: "0.05em", wordBreak: "break-all" }}>
              {exportedKey}
            </strong>
          </div>
        ) : null}
      </div>

      <ImportBackupModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => {
          bumpAttentionRevision();
          showDataToast(true, "Backup restored successfully");
        }}
      />

      <ResetAppModal
        isOpen={isResetOpen}
        onClose={() => setIsResetOpen(false)}
      />
    </>
  );
}
