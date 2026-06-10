import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Maximize2,
  ShieldAlert,
  Zap,
  Pause,
  Trash2,
} from "lucide-react";
import {
  buildAttentionAnalytics,
  buildDailySummary,
  buildSmartNudges,
} from "@flint/domain";
import {
  getCurrentDetectionSnapshot,
  setPrivateMode,
  clearAttentionEvents,
  addExcludedApp,
  type DetectionSnapshot,
} from "@/shared/api/attentionApi";
import { useAttentionSessions } from "@/shared/hooks/useAttentionSessions";
import { useAppStore } from "@/shared/store/appStore";
import { formatDuration } from "@/shared/lib/formatDuration";
import { FlintOrb } from "./FlintOrb";

export function CompactHUD({ onExpand }: { onExpand: () => void }) {
  const lastAttentionSample = useAppStore((s) => s.lastAttentionSample);
  const trackingStatus = useAppStore((s) => s.trackingStatus);
  const setTrackingStatus = useAppStore((s) => s.setTrackingStatus);
  const attentionRevision = useAppStore((s) => s.attentionRevision);
  const bumpAttentionRevision = useAppStore((s) => s.bumpAttentionRevision);

  const { data: events } = useAttentionSessions();
  const [detectionSnapshot, setDetectionSnapshot] = useState<DetectionSnapshot | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const sessions = events ?? [];
  const analytics = buildAttentionAnalytics(sessions);
  const summary = buildDailySummary(sessions);
  const isPaused = trackingStatus === "paused";

  const fallbackEvents = lastAttentionSample ? [lastAttentionSample] : [];
  const nudge = buildSmartNudges(sessions.length > 0 ? sessions : fallbackEvents)[0];
  const nudgeTone = isPaused ? "paused" : (nudge?.tone ?? "calm");

  async function refreshDetectionSnapshot() {
    try {
      const snapshot = await getCurrentDetectionSnapshot();
      setDetectionSnapshot(snapshot);
    } catch {
      // Ignored
    }
  }

  useEffect(() => {
    void refreshDetectionSnapshot();
    const timer = window.setInterval(() => void refreshDetectionSnapshot(), 3_000);
    return () => window.clearInterval(timer);
  }, [attentionRevision]);

  async function handleTogglePrivate() {
    const updatedSettings = await setPrivateMode(!isPaused);
    setTrackingStatus(updatedSettings.privateModeEnabled ? "paused" : "active");
  }

  async function handleExcludeCurrentApp() {
    if (detectionSnapshot?.rawAppName) {
      await addExcludedApp(detectionSnapshot.rawAppName);
      bumpAttentionRevision();
    }
  }

  async function handleWipeData() {
    if (!confirmWipe) {
      setConfirmWipe(true);
      window.setTimeout(() => setConfirmWipe(false), 4_000);
      return;
    }
    setConfirmWipe(false);
    await clearAttentionEvents();
    bumpAttentionRevision();
  }

  return (
    <div className="compact-hud-layout">
      <header className="hud-header">
        <div className="hud-brand">
          <FlintOrb className="hud-brand-orb" size={18} />
          <strong>Flint HUD</strong>
        </div>
        <button
          aria-label="Expand to Full App Dashboard"
          className="hud-action-btn expand-btn"
          onClick={onExpand}
          type="button"
        >
          <Maximize2 size={13} />
          <span>Dashboard</span>
        </button>
      </header>

      <section className={`hud-pulse-card state-${nudgeTone}`}>
        <div className="pulse-circle">
          <FlintOrb className="hud-state-orb" size={16} />
          <motion.div
            animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
            className="concentric-ripple"
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeOut" }}
          />
        </div>
        <div className="pulse-text">
          <span className="pulse-kicker">
            {isPaused ? "Ambient intelligence paused" : nudge?.title ?? "Deep flow continuous"}
          </span>
          <strong className="pulse-headline">
            {isPaused ? "Private Mode Active" : nudge?.detail ?? (detectionSnapshot?.enrichedAppName || "Quiet Reflection")}
          </strong>
        </div>
      </section>

      <div className="hud-main-grid">
        <div className="hud-orbit-wrapper">
          <svg viewBox="0 0 100 100" className="hud-orbit-svg">
            <circle className="hud-track" cx="50" cy="50" r="42" />
            <motion.circle
              className="hud-value"
              cx="50"
              cy="50"
              r="42"
              strokeDasharray="264"
              initial={{ strokeDashoffset: 264 }}
              animate={{ strokeDashoffset: 264 - (analytics.focusScore * 2.64) }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            />
          </svg>
          <div className="hud-orbit-label">
            <strong>{analytics.focusScore}</strong>
            <span>Score</span>
          </div>
        </div>

        <div className="hud-metrics-list">
          <div className="hud-metric">
            <span>Work Session</span>
            <strong>{formatDuration(analytics.focusSeconds)}</strong>
          </div>
          <div className="hud-metric">
            <span>Switches</span>
            <strong>{analytics.appSwitches} times</strong>
          </div>
          <div className="hud-metric">
            <span>AFK Gaps</span>
            <strong>{formatDuration(analytics.idleSeconds)}</strong>
          </div>
        </div>
      </div>

      <section className="hud-activity-panel">
        <span className="hud-section-title">Attention Path</span>
        {summary.recentPath.length > 0 ? (
          <div className="hud-path-steps">
            {summary.recentPath.slice(0, 3).map((app: string, index: number) => (
              <div className="hud-step" key={`${app}-${index}`}>
                <div className="step-marker" />
                <span>{app}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hud-empty-text">Waiting for application sample logs...</p>
        )}
      </section>

      <footer className="hud-controls">
        <button
          className={`hud-control-btn ${isPaused ? "active-resume" : ""}`}
          onClick={handleTogglePrivate}
          type="button"
        >
          {isPaused ? <Zap size={14} /> : <Pause size={14} />}
          <span>{isPaused ? "Resume" : "Private"}</span>
        </button>

        <button
          className="hud-control-btn"
          disabled={!detectionSnapshot?.rawAppName}
          onClick={handleExcludeCurrentApp}
          type="button"
        >
          <ShieldAlert size={14} />
          <span>Exclude App</span>
        </button>

        <button
          className={`hud-control-btn danger-btn ${confirmWipe ? "danger-btn-confirm" : ""}`}
          onClick={handleWipeData}
          type="button"
        >
          <Trash2 size={14} />
          <span>{confirmWipe ? "Confirm?" : "Wipe Logs"}</span>
        </button>
      </footer>
    </div>
  );
}
