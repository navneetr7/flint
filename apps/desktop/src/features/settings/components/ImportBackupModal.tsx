import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, KeyRound, X, ChevronRight } from "lucide-react";
import { pickBackupFile, importBackup } from "@/shared/api/attentionApi";

export function ImportBackupModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setStep(1);
    setFilePath(null);
    setPassword("");
    setError(null);
    onClose();
  }

  async function handlePickFile() {
    setLoading(true);
    setError(null);
    try {
      const path = await pickBackupFile();
      if (path) setFilePath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open file picker");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      await importBackup(filePath, password || undefined);
      onSuccess();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  const fileName = filePath ? filePath.split("/").pop() : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="wizard-modal-overlay">
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="wizard-modal-card"
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          >
            <header className="wizard-header-main">
              <div className="header-info">
                <FolderOpen size={18} />
                <h2>Import Backup</h2>
              </div>
              <button className="wizard-close-btn" onClick={handleClose} type="button">
                <X size={16} />
              </button>
            </header>

            <div className="wizard-stepper">
              <div className={`step-dot ${step >= 1 ? "active" : ""} ${filePath ? "completed" : ""}`}>
                <span>1</span>
                <label>Select file</label>
              </div>
              <div className="step-line" />
              <div className={`step-dot ${step >= 2 ? "active" : ""}`}>
                <span>2</span>
                <label>Decrypt</label>
              </div>
            </div>

            <div className="wizard-body">
              {step === 1 && (
                <div className="step-content">
                  <h3>Select your backup file</h3>
                  <p className="step-desc">
                    Choose the <strong>.atbk</strong> file you exported from Flint.
                    This will replace all current on-device data.
                  </p>
                  <button
                    className="import-file-pick-btn"
                    disabled={loading}
                    type="button"
                    onClick={() => void handlePickFile()}
                  >
                    <FolderOpen size={16} />
                    <span>{loading ? "Opening…" : filePath ? filePath.split("/").pop() : "Choose backup file"}</span>
                  </button>
                  {error && <p className="import-error">{error}</p>}
                </div>
              )}

              {step === 2 && (
                <div className="step-content">
                  <h3>Enter decryption key</h3>
                  <p className="step-desc">
                    Enter the backup key that was shown when this backup was exported.
                    Leave blank if this is an older backup.
                  </p>

                  <div className="import-file-selected">
                    <FolderOpen size={14} />
                    <span>{fileName}</span>
                  </div>

                  <div className="import-key-input-row">
                    <KeyRound size={16} />
                    <input
                      autoFocus
                      aria-label="Backup decryption key"
                      placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx"
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handleConfirm()}
                    />
                  </div>

                  {error && <p className="import-error">{error}</p>}
                </div>
              )}
            </div>

            <footer className="wizard-footer">
              <button
                className="back-btn"
                type="button"
                onClick={step === 1 ? handleClose : () => { setStep(1); setError(null); }}
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>

              <div className="footer-actions">
                {step === 1 ? (
                  <button
                    className="next-btn"
                    disabled={!filePath || loading}
                    type="button"
                    onClick={() => setStep(2)}
                  >
                    <span>Next</span>
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    className="finish-btn"
                    disabled={loading}
                    type="button"
                    onClick={() => void handleConfirm()}
                  >
                    {loading ? "Restoring…" : "Confirm import"}
                  </button>
                )}
              </div>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
