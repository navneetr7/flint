import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpCircle, X } from "lucide-react";
import { checkForUpdate, openUrl, type UpdateInfo } from "@/shared/api/systemApi";

const CACHE_KEY = "flint_update_check";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function UpdateModal() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL_MS) {
          if (data) { setUpdate(data); setOpen(true); }
          return;
        }
      } catch {}
    }
    checkForUpdate().then((info) => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: info }));
      if (info) { setUpdate(info); setOpen(true); }
    }).catch(() => {});
  }, []);

  if (!update) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="wizard-modal-overlay">
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="wizard-modal-card"
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            style={{ maxWidth: 400 }}
          >
            <header className="wizard-header-main">
              <div className="header-info" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ArrowUpCircle size={16} style={{ color: "var(--color-recovery-teal)" }} />
                <h2>Update available</h2>
              </div>
              <button className="wizard-close-btn" type="button" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </header>

            <div className="wizard-body">
              <div className="step-content">
                <p className="step-desc">
                  <strong style={{ color: "var(--color-recovery-teal)" }}>{update.version}</strong> is available.
                  Download and replace your current installation to update.
                </p>
              </div>
            </div>

            <footer className="wizard-footer">
              <button className="back-btn" type="button" onClick={() => setOpen(false)}>
                Later
              </button>
              <div className="footer-actions">
                <button
                  className="finish-btn"
                  type="button"
                  style={{ background: "rgba(96,168,160,0.15)", borderColor: "rgba(96,168,160,0.4)", color: "var(--color-recovery-teal)" }}
                  onClick={() => { openUrl(update.url); setOpen(false); }}
                >
                  Download
                </button>
              </div>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
