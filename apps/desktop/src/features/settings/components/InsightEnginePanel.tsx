import { useEffect, useState } from "react";
import {
  getAiClassificationSettings,
  setAiClassificationSettings,
  testAiConfig,
  type AiClassificationSettings,
} from "@/shared/api/attentionApi";
import { InsightEngineWizard } from "./InsightEngineWizard";

function StatusBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-badge">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function InsightEnginePanel() {
  const [aiSettings, setAiSettings] = useState<AiClassificationSettings | null>(null);
  const [isInsightWizardOpen, setIsInsightWizardOpen] = useState(false);
  const [aiTestState, setAiTestState] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [aiTestMessage, setAiTestMessage] = useState("");

  useEffect(() => {
    getAiClassificationSettings().then(setAiSettings).catch(() => undefined);
  }, []);

  async function handleAiSave(enabled: boolean, apiKey: string, provider: string, model: string, baseUrl: string) {
    const updated = await setAiClassificationSettings(enabled, apiKey, provider, model, baseUrl);
    setAiSettings(updated);
  }

  async function handleTestAiConfig() {
    setAiTestState("running");
    setAiTestMessage("");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const msg = await testAiConfig();
      setAiTestMessage(msg);
      setAiTestState("ok");
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
      setAiTestState("error");
    } finally {
      setTimeout(() => setAiTestState("idle"), 4000);
    }
  }

  return (
    <>
      {aiTestState !== "idle" && aiTestState !== "running" && aiTestMessage && (
        <div className={`ai-test-toast ${aiTestState}`}>{aiTestMessage}</div>
      )}

      <div className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <span className="section-kicker-row">
              <span className="section-kicker">Insight Engine</span>
              <span className={`engine-status-pill ${aiSettings?.enabled ? "engine-status-on" : "engine-status-off"}`}>
                {aiSettings?.enabled ? "Enabled" : "Disabled"}
              </span>
            </span>
            <h2>{aiSettings?.model ?? "DeepSeek V4 Pro"}</h2>
          </div>
          <div className="ai-panel-header-actions">
            {aiSettings?.hasApiKey && (
              <button
                className={`ai-edit-btn${aiTestState === "running" ? " ai-edit-btn--running" : ""}`}
                type="button"
                onClick={aiTestState === "running" ? undefined : () => void handleTestAiConfig()}
              >
                {aiTestState === "running" ? (
                  <svg className="ai-edit-btn-spinner" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
                    <path d="M10 2a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                ) : "Test"}
              </button>
            )}
            <button
              className="ai-edit-btn"
              type="button"
              onClick={() => setIsInsightWizardOpen(true)}
            >
              Edit
            </button>
          </div>
        </div>
        <div className="diagnostics-grid">
          <StatusBadge label="Provider" value={aiSettings?.provider ?? "deepseek"} />
          <StatusBadge label="Model" value={aiSettings?.model ?? "deepseek-v4-pro"} />
          <StatusBadge label="AI Classification" value={aiSettings?.enabled ? "Enabled" : "Disabled"} />
        </div>
      </div>

      <InsightEngineWizard
        isOpen={isInsightWizardOpen}
        aiSettings={aiSettings}
        onClose={() => setIsInsightWizardOpen(false)}
        onSave={handleAiSave}
      />
    </>
  );
}
