import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { IoCloseOutline } from "react-icons/io5";
import { useEffect, useState } from "react";
import type { AiClassificationSettings, BrowserPermissionResult, DetectionSnapshot } from "@/shared/api/attentionApi";
import {
  checkBrowserPermission,
  getAiClassificationSettings,
  getCurrentDetectionSnapshot,
  getPermissionStatus,
  getPrivacySettings,
  markOnboardingCompleted,
  openAutomationSettings,
  setAiClassificationSettings,
  setCollectWindowTitles,
  setShowTrayLabel,
  type PermissionStatus,
} from "@/shared/api/attentionApi";

import { openAccessibilitySettings, requestAccessibilityPermission } from "@/shared/api/systemApi";

const SUPPORTED_BROWSERS = ["Google Chrome", "Arc", "Safari", "Comet", "Atlas"] as const;
type BrowserStatuses = Record<string, BrowserPermissionResult | null>;

type ProviderId = "openai" | "anthropic" | "deepseek" | "openrouter";
type ApiFormat = "openai" | "anthropic";

interface ProviderDef {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  models: string[];
  keyPlaceholder: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    models: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiFormat: "openai",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai",
    models: ["meta-llama/llama-4-scout:free", "google/gemini-2.0-flash-exp:free", "deepseek/deepseek-r1:free"],
    keyPlaceholder: "sk-or-...",
  },
];

function getProvider(id: string): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[2];
}

const TOTAL_STEPS = 6;

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1);

  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [snapshot, setSnapshot] = useState<DetectionSnapshot | null>(null);
  const [browserStatuses, setBrowserStatuses] = useState<BrowserStatuses>({});
  const [checking, setChecking] = useState(false);

  const [collectWindowTitles, setCollectWindowTitlesState] = useState(true);
  const [showTrayLabelState, setShowTrayLabelState] = useState(true);

  const [aiSettings, setAiSettings] = useState<AiClassificationSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderDef>(PROVIDERS[2]);
  const [selectedModel, setSelectedModel] = useState(PROVIDERS[2].models[0]);
  const [apiKey, setApiKey] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);

  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    try {
      const [perms, snap, privSettings, ai] = await Promise.all([
        getPermissionStatus(),
        getCurrentDetectionSnapshot(),
        getPrivacySettings(),
        getAiClassificationSettings(),
      ]);
      setPermissions(perms);
      setSnapshot(snap);
      setCollectWindowTitlesState(privSettings.collectWindowTitles);
      setShowTrayLabelState(privSettings.showTrayLabel);
      setAiSettings(ai);
      const p = getProvider(ai.provider);
      setSelectedProvider(p);
      setSelectedModel(ai.model || p.models[0]);
      setAiEnabled(ai.enabled);
    } catch {}
  }

  async function runPermissionDiagnostics() {
    setChecking(true);
    try {
      const [perms, snap] = await Promise.all([getPermissionStatus(), getCurrentDetectionSnapshot()]);
      setPermissions(perms);
      setSnapshot(snap);
    } catch {
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
    } finally {
      setChecking(false);
    }
  }

  async function handleStepChange(next: number) {
    setStep(next);
    if (next === 3 && Object.keys(browserStatuses).length === 0) {
      await refreshBrowserStatuses();
    }
  }

  async function handleContextToggle() {
    const next = !collectWindowTitles;
    setCollectWindowTitlesState(next);
    try { await setCollectWindowTitles(next); } catch {}
  }

  async function handleTrayLabelToggle() {
    const next = !showTrayLabelState;
    setShowTrayLabelState(next);
    try { await setShowTrayLabel(next); } catch {}
  }

  async function handleSaveAi() {
    if (!apiKey.trim() && !aiSettings?.hasApiKey) return;
    setAiSaving(true);
    try {
      await setAiClassificationSettings(
        aiEnabled,
        apiKey.trim() || undefined,
        selectedProvider.id,
        selectedModel,
        selectedProvider.baseUrl,
      );
    } finally {
      setAiSaving(false);
    }
  }

  async function handleFinish() {
    setCompleting(true);
    try {
      await setShowTrayLabel(true);
      await markOnboardingCompleted();
      onComplete();
    } catch {
      setCompleting(false);
    }
  }

  const isAccessibilityReady = permissions?.activeAppAccess === "Ready";
  const anyBrowserReady = Object.values(browserStatuses).some((s) => s?.status === "ready");
  const canSaveAi = apiKey.trim() !== "" || Boolean(aiSettings?.hasApiKey);

  async function handleSaveAndNext() {
    if (canSaveAi) await handleSaveAi();
    await handleStepChange(6);
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        animate={{ opacity: 1, y: 0 }}
        className="onboarding-root"
        exit={{ opacity: 0, y: -8 }}
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
          {step === 1 ? (
            <WelcomeStep onNext={() => void handleStepChange(2)} />
          ) : (
            <>
              <OnboardingStepper
                step={step}
                isAccessibilityReady={isAccessibilityReady}
                anyBrowserReady={anyBrowserReady}
                aiEnabled={aiEnabled}
              />

              <div className="wizard-body">
                {step === 2 && (
                  <AccessibilityStep
                    isAccessibilityReady={isAccessibilityReady}
                    checking={checking}
                    onOpenSettings={async () => {
                      // Trigger the native macOS prompt — this adds Flint to the
                      // Accessibility list automatically so the user only flips the toggle.
                      await requestAccessibilityPermission();
                      // Open the pane so they can see the toggle.
                      await openAccessibilitySettings();
                      // Re-check after a short delay to pick up the grant.
                      setTimeout(() => void runPermissionDiagnostics(), 1500);
                    }}
                    onCheck={() => void runPermissionDiagnostics()}
                  />
                )}
                {step === 3 && (
                  <BrowserStep
                    browserStatuses={browserStatuses}
                    checking={checking}
                    onOpenSettings={() => void openAutomationSettings()}
                    onRecheck={() => void refreshBrowserStatuses()}
                  />
                )}
                {step === 4 && (
                  <FeaturesStep
                    collectWindowTitles={collectWindowTitles}
                    showTrayLabel={showTrayLabelState}
                    onContextToggle={() => void handleContextToggle()}
                    onTrayLabelToggle={() => void handleTrayLabelToggle()}
                  />
                )}
                {step === 5 && (
                  <AiStep
                    aiSettings={aiSettings}
                    selectedProvider={selectedProvider}
                    selectedModel={selectedModel}
                    apiKey={apiKey}
                    aiEnabled={aiEnabled}
                    onProviderSelect={(p) => { setSelectedProvider(p); setSelectedModel(p.models[0]); }}
                    onModelChange={setSelectedModel}
                    onApiKeyChange={setApiKey}
                    onAiEnabledChange={setAiEnabled}
                  />
                )}
                {step === 6 && (
                  <DoneStep
                    isAccessibilityReady={isAccessibilityReady}
                    anyBrowserReady={anyBrowserReady}
                    collectWindowTitles={collectWindowTitles}
                    aiEnabled={aiEnabled}
                    snapshot={snapshot}
                  />
                )}
              </div>

              <footer className="wizard-footer">
                <button
                  className="back-btn"
                  disabled={step <= 2}
                  onClick={() => setStep((s) => s - 1)}
                  type="button"
                >
                  Back
                </button>
                <div className="footer-actions">
                  {step < TOTAL_STEPS ? (
                    <>
                      {step === 5 ? (
                        <>
                          <button
                            className="check-btn"
                            onClick={() => void handleStepChange(6)}
                            type="button"
                          >
                            Skip
                          </button>
                          <button
                            className="next-btn"
                            disabled={!canSaveAi || aiSaving}
                            onClick={() => void handleSaveAndNext()}
                            type="button"
                          >
                            <span>{aiSaving ? "Saving…" : "Next"}</span>
                            <ChevronRight size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="next-btn"
                          onClick={() => void handleStepChange(step + 1)}
                          type="button"
                        >
                          <span>Next</span>
                          <ChevronRight size={14} />
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      className="finish-btn"
                      disabled={completing}
                      onClick={() => void handleFinish()}
                      type="button"
                    >
                      {completing ? "Setting up…" : "Launch Flint"}
                    </button>
                  )}
                </div>
              </footer>
            </>
          )}
      </motion.div>
    </AnimatePresence>
  );
}

function OnboardingStepper({
  step,
  isAccessibilityReady,
  anyBrowserReady,
  aiEnabled,
}: {
  step: number;
  isAccessibilityReady: boolean;
  anyBrowserReady: boolean;
  aiEnabled: boolean;
}) {
  const steps = [
    { label: "Access",   minStep: 2, ok: isAccessibilityReady },
    { label: "Browser",  minStep: 3, ok: anyBrowserReady },
    { label: "Features", minStep: 4, ok: true },
    { label: "AI",       minStep: 5, ok: aiEnabled },
    { label: "Done",     minStep: 6, ok: true },
  ];

  return (
    <div className="wizard-stepper">
      {steps.map((s, i) => {
        const isPast    = step > s.minStep;
        const isCurrent = step === s.minStep;
        const dotKind   = isPast ? (s.ok ? "ok" : "fail") : isCurrent ? "current" : "future";
        const lineKind  = isPast ? (s.ok ? "ok" : "fail") : "pending";

        return (
          <div key={s.label} style={{ display: "contents" }}>
            <div className={`step-dot step-dot-${dotKind}`}>
              <span>
                {isPast && s.ok  && <Check size={11} strokeWidth={3} />}
                {isPast && !s.ok && <IoCloseOutline size={14} />}
                {!isPast && (i + 1)}
              </span>
              <label>{s.label}</label>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-line step-line-${lineKind}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="onboarding-welcome">
      <div className="onboarding-welcome-brand">
        <img
          alt="Flint"
          className="onboarding-app-icon"
          src="/flint-icon.png"
        />
        <h1>Welcome to Flint</h1>
        <p className="onboarding-welcome-tagline">See exactly where your attention goes</p>
        <p className="onboarding-welcome-body">
          Flint measures focus, distraction, and recovery throughout your day, then turns that activity into clear, private insights
        </p>
        <p className="onboarding-welcome-body">
          Everything stays on your Mac. No cloud.<br />
          No screenshots. No keylogging.
        </p>
      </div>

      <div className="onboarding-welcome-cta">
        <button className="next-btn onboarding-get-started-btn" onClick={onNext} type="button">
          <span>Get Started</span>
          <ChevronRight size={16} />
        </button>
        <p className="onboarding-setup-note">Setup takes about 2 minutes</p>
      </div>
    </div>
  );
}

function AccessibilityStep({
  isAccessibilityReady,
  checking,
  onOpenSettings,
  onCheck,
}: {
  isAccessibilityReady: boolean;
  checking: boolean;
  onOpenSettings: () => void;
  onCheck: () => void;
}) {
  return (
    <div className="step-content">
      <h3>Step 1 — macOS Accessibility</h3>
      <p className="step-desc">
        Flint tracks your active desktop application locally. macOS requires Accessibility
        permission for the background tracker to detect the frontmost window.
      </p>

      <div className="guidelines-card">
        <h4>How to enable:</h4>
        <ol>
          <li>Click <strong>Open Settings</strong> below.</li>
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
          <button className="check-btn" onClick={onOpenSettings} type="button">
            <ExternalLink size={12} />
            <span>Open Settings</span>
          </button>
          <button className="check-btn" disabled={checking} onClick={onCheck} type="button">
            {checking ? "Checking…" : "Check"}
          </button>
        </div>
      </div>

      {!isAccessibilityReady && (
        <div className="remediation-hint">
          Grant Accessibility access, then click <strong>Check</strong> above.
        </div>
      )}
    </div>
  );
}

function BrowserStep({
  browserStatuses,
  checking,
  onOpenSettings,
  onRecheck,
}: {
  browserStatuses: BrowserStatuses;
  checking: boolean;
  onOpenSettings: () => void;
  onRecheck: () => void;
}) {
  return (
    <div className="step-content">
      <h3>Step 2 — Browser Site Awareness</h3>
      <p className="step-desc">
        To capture active tab domains (e.g. github.com, youtube.com) Flint uses Apple Events.
        Each browser needs a Developer menu toggle and Automation permission in System Settings.
      </p>

      <div className="guidelines-card">
        <h4>Enable in your browser first:</h4>
        <p>
          <strong>Chrome / Arc / Comet / Atlas:</strong> Developer menu →{" "}
          <em>Allow JavaScript from Apple Events</em>
        </p>
        <p>
          <strong>Safari:</strong> Settings → Advanced → Show developer features, then Developer
          menu → <em>Allow JavaScript from Apple Events</em>
        </p>
        <p style={{ marginTop: 8 }}>
          Then grant Flint permission in{" "}
          <button className="inline-link-btn" type="button" onClick={onOpenSettings}>
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

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button className="check-btn" onClick={onOpenSettings} type="button">
          <ExternalLink size={12} />
          <span>Open Automation Settings</span>
        </button>
        <button className="check-btn" disabled={checking} onClick={onRecheck} type="button">
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>
    </div>
  );
}

function FeaturesStep({
  collectWindowTitles,
  showTrayLabel,
  onContextToggle,
  onTrayLabelToggle,
}: {
  collectWindowTitles: boolean;
  showTrayLabel: boolean;
  onContextToggle: () => void;
  onTrayLabelToggle: () => void;
}) {
  return (
    <div className="step-content">
      <h3>Step 3 — Context &amp; Notifications</h3>
      <p className="step-desc">
        Configure how much context Flint captures and how it surfaces your focus state.
      </p>

      <div className="onboarding-feature-row">
        <div className="onboarding-feature-info">
          <Eye size={16} className="text-cyan" />
          <div>
            <strong>Context awareness</strong>
            <p>Capture active window titles for richer categorisation. Titles are encrypted at rest.</p>
          </div>
        </div>
        <button
          className={`insight-toggle-btn ${collectWindowTitles ? "insight-toggle-on" : ""}`}
          type="button"
          onClick={onContextToggle}
        >
          {collectWindowTitles ? "On" : "Off"}
        </button>
      </div>

      <div className="onboarding-feature-row">
        <div className="onboarding-feature-info">
          <Bell size={16} className="text-orange" />
          <div>
            <strong>Dynamic notifications</strong>
            <p>Show a live focus state label in your menu bar tray pill.</p>
          </div>
        </div>
        <button
          className={`insight-toggle-btn ${showTrayLabel ? "insight-toggle-on" : ""}`}
          type="button"
          onClick={onTrayLabelToggle}
        >
          {showTrayLabel ? "On" : "Off"}
        </button>
      </div>

      {!showTrayLabel && (
        <div className="remediation-hint">
          Dynamic notifications are recommended — they give you real-time feedback without opening the app.
        </div>
      )}
    </div>
  );
}

function AiStep({
  aiSettings,
  selectedProvider,
  selectedModel,
  apiKey,
  aiEnabled,
  onProviderSelect,
  onModelChange,
  onApiKeyChange,
  onAiEnabledChange,
}: {
  aiSettings: AiClassificationSettings | null;
  selectedProvider: ProviderDef;
  selectedModel: string;
  apiKey: string;
  aiEnabled: boolean;
  onProviderSelect: (p: ProviderDef) => void;
  onModelChange: (m: string) => void;
  onApiKeyChange: (k: string) => void;
  onAiEnabledChange: (v: boolean) => void;
}) {
  return (
    <div className="step-content">
      <h3>
        Step 4 — AI Insight Engine{" "}
        <span className="ai-step-optional">( Optional — Flint works fully without AI )</span>
      </h3>
      <p className="step-desc" style={{ whiteSpace: "nowrap" }}>
        Improve classification for unknown apps, tabs, and window titles with your own LLM. Metadata only. No screenshots. No content access.
      </p>

      <div className="insight-wizard-section">
        <p className="insight-section-heading">Provider</p>
        <div className="insight-provider-grid">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`insight-provider-pill ${selectedProvider.id === p.id ? "active" : ""}`}
              type="button"
              onClick={() => onProviderSelect(p)}
            >
              {selectedProvider.id === p.id && <Check size={10} />}
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="insight-wizard-section">
        <p className="insight-section-heading">Model</p>
        <div className="insight-model-select-wrap">
          <select
            className="insight-model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {selectedProvider.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <ChevronDown size={14} className="insight-select-icon" />
        </div>
      </div>

      <div className="insight-wizard-section">
        <div className="insight-section-label" style={{ marginBottom: 8 }}>
          <KeyRound size={14} />
          <span>API Key {aiSettings?.hasApiKey ? "(already saved)" : ""}</span>
        </div>
        <input
          className="insight-key-input"
          placeholder={!aiSettings?.hasApiKey ? selectedProvider.keyPlaceholder : "Enter new key to update…"}
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />
      </div>

      <div className="insight-wizard-section">
        <div className="insight-section-row">
          <div className="insight-section-label">
            <div>
              <span>AI Classification</span>
              <p className="insight-section-sub">Classify unrecognized apps and web context</p>
            </div>
          </div>
          <button
            className={`insight-toggle-btn ${aiEnabled ? "insight-toggle-on" : ""}`}
            type="button"
            onClick={() => onAiEnabledChange(!aiEnabled)}
          >
            {aiEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      <p className="insight-footer-note" style={{ marginTop: 4 }}>
        <ShieldCheck size={12} />
        API key encrypted with AES-256-GCM
      </p>
    </div>
  );
}

function DoneStep({
  isAccessibilityReady,
  anyBrowserReady,
  collectWindowTitles,
  aiEnabled,
}: {
  isAccessibilityReady: boolean;
  anyBrowserReady: boolean;
  collectWindowTitles: boolean;
  aiEnabled: boolean;
  snapshot: DetectionSnapshot | null;
}) {
  const items = [
    { label: "App tracking", on: isAccessibilityReady },
    { label: "Browser awareness", on: anyBrowserReady },
    { label: "Context capture", on: collectWindowTitles },
    { label: "Notifications", on: true },
    { label: "AI engine", on: aiEnabled },
  ];

  return (
    <div className="step-content">
      <h3>Step 5 — Flint Is Live</h3>
      <p className="step-desc">Your attention mirror is ready.</p>
      <p className="step-desc" style={{ marginTop: -8 }}>
        As you work, Flint will quietly track focus, context switches, and recovery
        patterns — all locally on your Mac.
      </p>

      <div className="done-status-card">
        <p className="done-status-heading">Current Status</p>
        {items.map((item) => (
          <div key={item.label} className="done-status-row">
            {item.on
              ? <CheckCircle2 size={14} className="text-teal" />
              : <XCircle size={14} className="done-status-x" />
            }
            <span className={item.on ? "done-status-label" : "done-status-label done-label-off"}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
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
