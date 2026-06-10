import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { resetApp } from "@/shared/api/systemApi";

export function ResetAppModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setResetting(true);
    setError(null);
    try {
      await resetApp();
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      setResetting(false);
    }
  }

  function handleClose() {
    if (resetting) return;
    setError(null);
    onClose();
  }

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
            style={{ maxWidth: 480 }}
          >
            <header className="wizard-header-main">
              <div className="header-info">
                <h2>Reset Flint</h2>
              </div>
              <button className="wizard-close-btn" type="button" onClick={handleClose}>
                <X size={16} />
              </button>
            </header>

            <div className="wizard-body">
              <div className="step-content">
                <p className="step-desc">
                  This will permanently erase everything — all attention data, AI settings,
                  classification rules, and app configuration.
                </p>
                <p className="step-desc" style={{ marginTop: 8 }}>
                  Flint will return to first-run onboarding. <strong>This cannot be undone.</strong>
                </p>
                {error && <p className="import-error" style={{ marginTop: 12 }}>{error}</p>}
              </div>
            </div>

            <footer className="wizard-footer">
              <button className="back-btn" type="button" disabled={resetting} onClick={handleClose}>
                Cancel
              </button>
              <div className="footer-actions">
                <button
                  className="finish-btn"
                  type="button"
                  disabled={resetting}
                  style={{ background: "rgba(192, 104, 120, 0.15)", borderColor: "rgba(192, 104, 120, 0.4)", color: "var(--color-drift-red)" }}
                  onClick={() => void handleConfirm()}
                >
                  {resetting ? "Resetting…" : "Reset everything"}
                </button>
              </div>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
