import { useEffect, useRef, useState } from "react";
import {
  addClassificationRule,
  deleteClassificationRule,
  listClassificationRules,
  listAttentionEvents,
  type ClassificationRule,
} from "@/shared/api/attentionApi";
import { useAppStore } from "@/shared/store/appStore";
import { formatDuration } from "@/shared/lib/formatDuration";
import { CATEGORY_OPTIONS } from "@/shared/lib/categoryMeta";
import {
  Tag,
  Trash2,
  Globe,
  Monitor,
  Sparkles,
  HelpCircle,
  CheckCircle,
} from "lucide-react";

const UNCLASSIFIED_LIMIT = 5;

export function ClassificationSettings() {
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [unclassified, setUnclassified] = useState<{ name: string; count: number; duration: number }[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  
  // Form fields
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("development");
  const [matchKind, setMatchKind] = useState("exact");
  
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"rules" | "unclassified">("unclassified");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAllUnclassified, setShowAllUnclassified] = useState(false);

  const attentionRevision = useAppStore((state) => state.attentionRevision);
  const bumpAttentionRevision = useAppStore((state) => state.bumpAttentionRevision);

  useEffect(() => {
    void loadData();
  }, [attentionRevision]);

  useEffect(() => {
    if (unclassified.length <= UNCLASSIFIED_LIMIT) {
      setShowAllUnclassified(false);
    }
  }, [unclassified.length]);

  async function loadData() {
    try {
      const activeRules = await listClassificationRules();
      setRules(activeRules);

      // Fetch events to detect unclassified apps & sites
      const events = await listAttentionEvents();
      
      const counts: Record<string, { count: number; duration: number }> = {};
      events.forEach((event) => {
        // Unclassified is marked as "unknown", or "browser" category which hasn't matched a custom rule
        if (event.category === "unknown" || event.category === "browser") {
          const key = event.appName;
          if (!counts[key]) {
            counts[key] = { count: 0, duration: 0 };
          }
          counts[key].count += 1;
          counts[key].duration += event.durationSeconds;
        }
      });

      const unclassifiedList = Object.entries(counts)
        .map(([name, stats]) => ({
          name,
          count: stats.count,
          duration: stats.duration,
        }))
        .sort((a, b) => b.duration - a.duration);

      setUnclassified(unclassifiedList);
    } catch {
      // Ignored in preview
    }
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || !displayName.trim()) {
      return;
    }

    setLoading(true);
    try {
      await addClassificationRule(
        token.toLowerCase().trim(),
        displayName.trim(),
        category,
        matchKind
      );
      
      setToken("");
      setDisplayName("");
      setSuccessMessage(`Successfully classified "${displayName}"`);
      setTimeout(() => setSuccessMessage(null), 3000);
      
      bumpAttentionRevision();
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRule(ruleToken: string) {
    try {
      await deleteClassificationRule(ruleToken);
      bumpAttentionRevision();
    } catch {
      // Ignored
    }
  }

  function handleSelectUnclassified(rawName: string) {
    let cleanToken = rawName;
    let cleanDisplay = rawName;
    let inferredMatchKind = "exact";

    // If browser event format (e.g. "Google Chrome: github.com")
    if (rawName.includes(": ")) {
      const [, domain] = rawName.split(": ");
      cleanToken = domain.trim();
      inferredMatchKind = "host";
      
      // Capitialize parts of domain for a neat display name (e.g., github.com -> Github)
      const domainParts = cleanToken.split(".");
      const coreName = domainParts[domainParts.length - 2] || domainParts[0];
      cleanDisplay = coreName.charAt(0).toUpperCase() + coreName.slice(1);
    } else {
      cleanDisplay = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    }

    setToken(cleanToken);
    setDisplayName(cleanDisplay);
    setMatchKind(inferredMatchKind);
    setActiveTab("rules"); // Switch to rules view to see the prefilled form
    
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  }


  return (
    <div className="settings-panel classification-container">
      <div className="settings-panel-header">
        <div>
          <span className="section-kicker">App Classification</span>
          <h2>Category rules & mapping</h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="classification-tabs">
        <button
          className={`classification-tab ${activeTab === "unclassified" ? "active" : ""}`}
          onClick={() => setActiveTab("unclassified")}
          type="button"
        >
          <Sparkles size={14} />
          <span>Unclassified Bucket</span>
          {unclassified.length > 0 && (
            <span className="badge-count">{unclassified.length}</span>
          )}
        </button>
        <button
          className={`classification-tab ${activeTab === "rules" ? "active" : ""}`}
          onClick={() => setActiveTab("rules")}
          type="button"
        >
          <Tag size={14} />
          <span>Rules Database</span>
          <span className="badge-count bg-surface-strong">
            {rules.filter((r) => r.source === "user").length} custom
          </span>
        </button>
      </div>

      {activeTab === "unclassified" ? (
        <div className="tab-content">
          <p className="tab-description">
            Below are application logs and browser sites currently categorized as **"Unknown"** or generic **"Browser"**. Classifying them completes your focus score and drift metrics.
          </p>

          {unclassified.length === 0 ? (
            <div className="empty-state-card">
              <CheckCircle size={32} className="text-teal" />
              <h3>All attention mapped!</h3>
              <p>You have classified all recent apps and site visits. Keep it up!</p>
            </div>
          ) : (
            <div className="unclassified-list">
              {(showAllUnclassified ? unclassified : unclassified.slice(0, UNCLASSIFIED_LIMIT)).map((item) => {
                const isBrowserSite = item.name.includes(": ");
                return (
                  <div key={item.name} className="unclassified-row">
                    <div className="item-info">
                      {isBrowserSite ? (
                        <Globe size={16} className="text-muted" />
                      ) : (
                        <Monitor size={16} className="text-muted" />
                      )}
                      <div className="name-details">
                        <span className="item-name">{item.name}</span>
                        <span className="item-stats">
                          Visited {item.count} times · {formatDuration(item.duration)} active
                        </span>
                      </div>
                    </div>
                    <button
                      className="classify-btn"
                      onClick={() => handleSelectUnclassified(item.name)}
                      type="button"
                    >
                      Classify
                    </button>
                  </div>
                );
              })}
              {unclassified.length > UNCLASSIFIED_LIMIT && (
                <button
                  className="show-more-btn"
                  onClick={() => setShowAllUnclassified((v) => !v)}
                  type="button"
                >
                  {showAllUnclassified ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="tab-content">
          {/* Add Rule Form */}
          <form ref={formRef} className="add-rule-form" onSubmit={(e) => void handleAddRule(e)}>
            <h3>Add custom classification rule</h3>
            
            {successMessage && (
              <div className="form-alert alert-success">
                <span>{successMessage}</span>
              </div>
            )}

            <div className="form-row">
              <div className="form-group rule-col-token">
                <label htmlFor="rule-token">Match Token</label>
                <input
                  id="rule-token"
                  placeholder="e.g. spotify or github.com"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>

              <div className="form-group rule-col-display">
                <label htmlFor="rule-display">Display Name</label>
                <input
                  id="rule-display"
                  placeholder="e.g. Spotify or GitHub"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="form-group rule-col-category">
                <label htmlFor="rule-category">Category</label>
                <select
                  id="rule-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group rule-col-matchtype">
                <label htmlFor="rule-match-kind">Match Type</label>
                <select
                  id="rule-match-kind"
                  value={matchKind}
                  onChange={(e) => setMatchKind(e.target.value)}
                >
                  <option value="exact">Exact string</option>
                  <option value="host">Web Host/Domain</option>
                </select>
              </div>

              <div className="form-group submit-group">
                <button className="save-rule-btn" disabled={loading} type="submit">
                  Save
                </button>
              </div>
            </div>
            
            <p className="field-hint">
              <HelpCircle size={12} />
              <span>
                **Exact string** matches the full desktop application name. **Web Host/Domain** extracts and matches browser domains and subdomains (e.g. `netflix.com`).
              </span>
            </p>
          </form>

          {/* Rules List */}
          <div className="rules-list-section">
            <h3>Your Classification Rules</h3>
            <div className="rules-grid">
              {rules.map((rule) => {
                const isUserRule = rule.source === "user";
                return (
                  <div key={rule.token} className={`rule-card rule-card-${rule.category}`}>
                    <div className="rule-details">
                      <div className="token-row">
                        <strong className="rule-token">{rule.token}</strong>
                        <span className={`match-badge ${rule.matchKind}`}>
                          {rule.matchKind}
                        </span>
                      </div>
                      <div className="meta-row">
                        <span className="display-name">{rule.displayName}</span>
                        <span className="dot">·</span>
                        <span className="category-tag">{rule.category}</span>
                      </div>
                    </div>
                    {isUserRule && (
                      <button
                        aria-label={`Delete rule for ${rule.token}`}
                        className="delete-rule-btn"
                        onClick={() => void handleDeleteRule(rule.token)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
