import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X, ShieldCheck, KeyRound, ToggleLeft, ToggleRight, ChevronDown, Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiClassificationSettings } from "@/shared/api/attentionApi";

interface Props {
  isOpen: boolean;
  aiSettings: AiClassificationSettings | null;
  onClose: () => void;
  onSave: (enabled: boolean, apiKey: string, provider: string, model: string, baseUrl: string) => Promise<void>;
}

type ProviderId = "openai" | "anthropic" | "deepseek" | "openrouter";

// "openai" = OpenAI-compatible chat/completions format
// "anthropic" = Anthropic messages API (different headers + payload shape)
type ApiFormat = "openai" | "anthropic";

interface ProviderDef {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  requiresKey: boolean;
  models: string[];
  keyPlaceholder: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    requiresKey: true,
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    // Uses /v1/messages with anthropic-version header — not OpenAI-compatible
    baseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic",
    requiresKey: true,
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-7", "claude-sonnet-4-5"],
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiFormat: "openai",
    requiresKey: true,
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai",
    requiresKey: true,
    models: [
      "meta-llama/llama-4-scout:free",
      "google/gemini-2.0-flash-exp:free",
      "deepseek/deepseek-r1:free",
      "mistralai/mistral-7b-instruct:free",
      "nvidia/nemotron-3.5-content-safety:free",
    ],
    keyPlaceholder: "sk-or-...",
  },
];

function getProvider(id: string): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function InsightEngineWizard({ isOpen, aiSettings, onClose, onSave }: Props) {
  const savedProviderId = (aiSettings?.provider ?? "deepseek") as ProviderId;
  const savedProvider = getProvider(savedProviderId);

  const [selectedProvider, setSelectedProvider] = useState<ProviderDef>(savedProvider);
  const [selectedModel, setSelectedModel] = useState(aiSettings?.model ?? savedProvider.models[0] ?? "");
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(aiSettings?.enabled ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const p = getProvider((aiSettings?.provider ?? "deepseek") as ProviderId);
    setSelectedProvider(p);
    setSelectedModel(aiSettings?.model ?? p.models[0] ?? "");
    setCustomModel("");
    setApiKey("");
    setEnabled(aiSettings?.enabled ?? false);
  }, [isOpen]);

  const isCustomModel = selectedModel === "__custom__";
  const effectiveModel = isCustomModel ? customModel.trim() : selectedModel;

  const providerChanged = selectedProvider.id !== savedProviderId;
  const modelChanged = effectiveModel !== (aiSettings?.model ?? "");
  const enabledChanged = enabled !== (aiSettings?.enabled ?? false);
  const hasChanges = providerChanged || modelChanged || enabledChanged || apiKey.trim() !== "";
  const keyRequired = !aiSettings?.hasApiKey;
  const canSave = hasChanges && (!keyRequired || apiKey.trim() !== "") && effectiveModel !== "" && (!isCustomModel || customModel.trim() !== "");

  function handleProviderSelect(p: ProviderDef) {
    setSelectedProvider(p);
    setSelectedModel(p.models[0] ?? "");
    setCustomModel("");
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(enabled, apiKey.trim(), selectedProvider.id, effectiveModel, selectedProvider.baseUrl);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setSelectedProvider(savedProvider);
    setSelectedModel(aiSettings?.model ?? savedProvider.models[0] ?? "");
    setCustomModel("");
    setApiKey("");
    setEnabled(aiSettings?.enabled ?? false);
    onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="wizard-modal-overlay">
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="wizard-modal-card insight-wizard-card"
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          >
            <header className="wizard-header-main">
              <div className="header-info">
                <Sparkles size={18} className="text-cyan" />
                <h2>Insight Engine</h2>
              </div>
              <button className="wizard-close-btn" type="button" onClick={handleClose}>
                <X size={16} />
              </button>
            </header>

            <div className="insight-wizard-body">
              {/* Provider grid */}
              <div className="insight-wizard-section">
                <p className="insight-section-heading">Provider</p>
                <div className="insight-provider-grid">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={`insight-provider-pill ${selectedProvider.id === p.id ? "active" : ""}`}
                      type="button"
                      onClick={() => handleProviderSelect(p)}
                    >
                      {selectedProvider.id === p.id && <Check size={10} />}
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selector */}
              <div className="insight-wizard-section">
                <p className="insight-section-heading">Model</p>
                <div className="insight-model-select-wrap">
                  <select
                    className="insight-model-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    {selectedProvider.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="__custom__">Custom model…</option>
                  </select>
                  <ChevronDown size={14} className="insight-select-icon" />
                </div>
                {isCustomModel && (
                  <input
                    autoFocus
                    className="insight-key-input"
                    placeholder="Enter model name (e.g. nvidia/nemotron-3.5-content-safety:free)"
                    style={{ marginTop: 8 }}
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                  />
                )}
              </div>

              {/* API Key */}
              <div className="insight-wizard-section">
                <div className="insight-section-label" style={{ marginBottom: 8 }}>
                  <KeyRound size={14} />
                  <span>API Key</span>
                </div>
                <input
                  className="insight-key-input"
                  placeholder={selectedProvider.keyPlaceholder}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              {/* AI Classification toggle */}
              <div className="insight-wizard-section">
                <div className="insight-section-row">
                  <div className="insight-section-label">
                    {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    <div>
                      <span>AI Classification</span>
                      <p className="insight-section-sub">Classify unrecognized apps and web context</p>
                    </div>
                  </div>
                  <button
                    className={`insight-toggle-btn ${enabled ? "insight-toggle-on" : ""}`}
                    type="button"
                    onClick={() => setEnabled((v) => !v)}
                  >
                    {enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
            </div>

            <footer className="wizard-footer insight-wizard-footer">
              <p className="insight-footer-note">
                <ShieldCheck size={12} />
                Encrypted with AES-256-GCM
              </p>
              <div className="insight-footer-actions">
                {hasChanges && (
                  <button
                    className="insight-btn-primary"
                    disabled={!canSave || saving}
                    type="button"
                    onClick={handleSave}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                )}
                <button className="insight-btn-ghost" type="button" onClick={handleClose}>
                  Close
                </button>
              </div>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
