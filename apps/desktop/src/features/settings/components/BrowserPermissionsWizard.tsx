import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  X,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import {
  checkBrowserPermission,
  getCurrentDetectionSnapshot,
  getPermissionStatus,
  openAccessibilitySettings,
  openAutomationSettings,
  type BrowserPermissionResult,
  type DetectionSnapshot,
  type PermissionStatus,
} from "@/shared/api/attentionApi";

const SUPPORTED_BROWSERS = ["Google Chrome", "Arc", "Safari", "Comet", "Atlas"] as const;

type BrowserStatuses = Record<string, BrowserPermissionResult | null>;

export function BrowserPermissionsWizard({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [snapshot, setSnapshot] = useState<DetectionSnapshot | null>(null);
  const [browserStatuses, setBrowserStatuses] = useState<BrowserStatuses>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      void runDiagnostics();
    }
  }, [isOpen]);

  async function runDiagnostics() {
    setChecking(true);
    try {
      const [perms, snap] = await Promise.all([
        getPermissionStatus(),
        getCurrentDetectionSnapshot(),
      ]);
      setPermissions(perms);
      setSnapshot(snap);

      if (step === 2) {
        await refreshBrowserStatuses();
      }
    } catch {
      // Ignored
    } finally {
      setChecking(false);
    }
  }

  async function refreshBrowserStatuses() {
    setChecking(true);
    try {
      const results = await Promise.all(
        SUPPORTED_BROWSERS.map((name) =>
          checkBrowserPermission(name).then((r) => [name, r] as const),
        ),
      );
      setBrowserStatuses(Object.fromEntries(results));
    } catch {
      // Ignored
    } finally {
      setChecking(false);
    }
  }

  async function handleStepChange(next: number) {
    setStep(next);
    if (next === 2 && Object.keys(browserStatuses).length === 0) {
      await refreshBrowserStatuses();
    }
  }

  const isAccessibilityReady = permissions?.activeAppAccess === "Ready";
  const anyBrowserReady = Object.values(browserStatuses).some((s) => s?.status === "ready");

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
                <Shield size={20} className="text-cyan" />
                <h2>Integration &amp; Permissions Wizard</h2>
              </div>
              <button className="wizard-close-btn" onClick={onClose} type="button">
                <X size={16} />
              </button>
            </header>

            <div className="wizard-stepper">
              <div className={`step-dot ${step >= 1 ? "active" : ""} ${isAccessibilityReady ? "completed" : ""}`}>
                <span>1</span>
                <label>Accessibility</label>
              </div>
              <div className="step-line" />
              <div className={`step-dot ${step >= 2 ? "active" : ""} ${anyBrowserReady ? "completed" : ""}`}>
                <span>2</span>
                <label>Browser</label>
              </div>
              <div className="step-line" />
              <div className={`step-dot ${step >= 3 ? "active" : ""} ${isAccessibilityReady && anyBrowserReady ? "completed" : ""}`}>
                <span>3</span>
                <label>Verify</label>
              </div>
            </div>

            <div className="wizard-body">
              {step === 1 && (
                <div className="step-content">
                  <h3>Step 1 — macOS Accessibility</h3>
                  <p className="step-desc">
                    Flint tracks your active desktop application locally. macOS requires
                    Accessibility permission for the background tracker to detect the frontmost window.
                  </p>

                  <div className="guidelines-card">
                    <h4>How to enable:</h4>
                    <ol>
                      <li>Click <strong>Open System Settings</strong> below.</li>
                      <li>Navigate to <strong>Privacy &amp; Security → Accessibility</strong>.</li>
                      <li>Click <strong>+</strong> and select <strong>Flint</strong>.</li>
                      <li>Toggle the switch <strong>On</strong>.</li>
                    </ol>
                  </div>

                  <div className="status-checker-bar">
                    <div className="checker-info">
                      <StatusIcon status={isAccessibilityReady ? "ready" : "automation_denied"} />
                      <span>
                        Active app access:{" "}
                        <strong>{isAccessibilityReady ? "Ready" : "Not granted"}</strong>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="check-btn"
                        onClick={() => void openAccessibilitySettings()}
                        type="button"
                      >
                        <ExternalLink size={12} />
                        <span>Open Settings</span>
                      </button>
                      <button
                        className="check-btn"
                        disabled={checking}
                        onClick={() => void runDiagnostics()}
                        type="button"
                      >
                        <RefreshCw size={12} className={checking ? "spin" : ""} />
                        <span>Check</span>
                      </button>
                    </div>
                  </div>

                  {!isAccessibilityReady && (
                    <div className="remediation-hint">
                      Grant Accessibility access, then click <strong>Check</strong> above.
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="step-content">
                  <h3>Step 2 — Browser Site Awareness</h3>
                  <p className="step-desc">
                    To capture active tab domains (e.g. github.com, youtube.com) Flint uses
                    Apple Events. Each browser needs two things: a Developer menu toggle and an
                    Automation permission in System Settings.
                  </p>

                  <div className="guidelines-card">
                    <h4>Enable in your browser first:</h4>
                    <p>
                      <strong>Chrome / Arc / Comet / Atlas:</strong> Developer menu →{" "}
                      <em>Allow JavaScript from Apple Events</em>
                    </p>
                    <p>
                      <strong>Safari:</strong> Settings → Advanced → Show developer features, then
                      Developer menu → <em>Allow JavaScript from Apple Events</em>
                    </p>
                    <p style={{ marginTop: 8 }}>
                      Then grant Flint permission in{" "}
                      <button
                        className="inline-link-btn"
                        type="button"
                        onClick={() => void openAutomationSettings()}
                      >
                        System Settings → Automation
                        <ExternalLink size={11} style={{ marginLeft: 3 }} />
                      </button>
                    </p>
                  </div>

                  <div className="browser-status-list">
                    {SUPPORTED_BROWSERS.map((name) => {
                      const result = browserStatuses[name];
                      return (
                        <BrowserStatusRow
                          key={name}
                          name={name}
                          result={result ?? null}
                          loading={checking && !result}
                        />
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      className="check-btn"
                      onClick={() => void openAutomationSettings()}
                      type="button"
                    >
                      <ExternalLink size={12} />
                      <span>Open Automation Settings</span>
                    </button>
                    <button
                      className="check-btn"
                      disabled={checking}
                      onClick={() => void refreshBrowserStatuses()}
                      type="button"
                    >
                      <RefreshCw size={12} className={checking ? "spin" : ""} />
                      <span>Re-check</span>
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="step-content">
                  <h3>Step 3 — Verify Detection Stream</h3>
                  <p className="step-desc">
                    Live detection payload from the current moment. Confirm app, category, and
                    browser domain are captured correctly.
                  </p>

                  <div className="diagnostic-log-terminal">
                    <div className="terminal-header">
                      <span className="dot red" />
                      <span className="dot yellow" />
                      <span className="dot green" />
                      <span className="title">local_diagnostics_stream.log</span>
                    </div>
                    <div className="terminal-body">
                      <div><span className="text-muted">[TIME]</span> {new Date().toLocaleTimeString()}</div>
                      <div><span className="text-muted">[APP]</span> {snapshot?.rawAppName ?? "Detecting..."}</div>
                      <div><span className="text-muted">[ENRICHED]</span> {snapshot?.enrichedAppName ?? "none"}</div>
                      <div><span className="text-muted">[CATEGORY]</span> <span className="text-cyan">{snapshot?.category ?? "unknown"}</span></div>
                      <div><span className="text-muted">[TITLE]</span> {snapshot?.windowTitle ?? "none"}</div>
                      <div>
                        <span className="text-muted">[BROWSER]</span>{" "}
                        <span className={snapshot?.browserStatus === "ready" ? "text-teal" : "text-orange"}>
                          {snapshot?.browserDiagnostic ?? "untested"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">[ACCESSIBILITY]</span>{" "}
                        <span className={isAccessibilityReady ? "text-teal" : "text-orange"}>
                          {isAccessibilityReady ? "Ready" : "Not granted"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="wizard-checklist">
                    <div className="check-item">
                      <CheckCircle2 size={14} className={isAccessibilityReady ? "text-teal" : "text-soft"} />
                      <span>System active app tracking</span>
                    </div>
                    <div className="check-item">
                      <CheckCircle2 size={14} className={snapshot?.contextAwarenessEnabled ? "text-teal" : "text-soft"} />
                      <span>Window title capture</span>
                    </div>
                    <div className="check-item">
                      <CheckCircle2 size={14} className={anyBrowserReady ? "text-teal" : "text-soft"} />
                      <span>Browser domain awareness</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <footer className="wizard-footer">
              <button
                className="back-btn"
                disabled={step === 1}
                onClick={() => setStep((s) => s - 1)}
                type="button"
              >
                Back
              </button>

              <div className="footer-actions">
                <button
                  className="check-diagnostics-btn"
                  disabled={checking}
                  onClick={() => void runDiagnostics()}
                  type="button"
                >
                  {checking ? "Checking…" : "Refresh"}
                </button>
                {step < 3 ? (
                  <button
                    className="next-btn"
                    onClick={() => void handleStepChange(step + 1)}
                    type="button"
                  >
                    <span>Next</span>
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <button className="finish-btn" onClick={onClose} type="button">
                    Done
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

function StatusIcon({ status }: { status: string }) {
  if (status === "ready") return <CheckCircle2 size={15} className="text-teal" />;
  if (status === "not_browser" || status === "unsupported") return <XCircle size={15} className="text-soft" />;
  return <AlertCircle size={15} className="text-orange" />;
}

function statusLabel(status: string): string {
  switch (status) {
    case "ready": return "Ready";
    case "automation_denied": return "Permission denied";
    case "not_running": return "Not running";
    case "no_window": return "No tab open";
    case "no_url": return "No URL captured";
    case "not_browser": return "Not a browser";
    default: return "Unavailable";
  }
}

function BrowserStatusRow({
  name,
  result,
  loading,
}: {
  name: string;
  result: BrowserPermissionResult | null;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="browser-status-row">
      <button
        className="browser-status-row-header"
        type="button"
        disabled={!result}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="browser-status-row-left">
          {loading || !result ? (
            <RefreshCw size={14} className="spin text-soft" />
          ) : (
            <StatusIcon status={result.status} />
          )}
          <span className="browser-name">{name}</span>
        </div>
        <span className={`browser-status-badge ${result?.status === "ready" ? "badge-ready" : result?.status === "not_browser" ? "badge-neutral" : "badge-warn"}`}>
          {loading || !result ? "checking…" : statusLabel(result.status)}
        </span>
      </button>
      {expanded && result && result.status !== "ready" && result.status !== "not_browser" && (
        <div className="browser-status-row-detail">
          <p>{result.detail}</p>
          {result.remediation && <p className="remediation-text">{result.remediation}</p>}
        </div>
      )}
    </div>
  );
}
