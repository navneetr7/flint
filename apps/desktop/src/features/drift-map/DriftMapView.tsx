import { useMemo, useState, useEffect, useRef } from "react";
import { buildAttentionAnalytics, isFocusCategory, isDistractionCategory, type AttentionEvent } from "@flint/domain";
import { useAttentionSessions, useAttentionSessionsThrottled } from "@/shared/hooks/useAttentionSessions";
import { motion, AnimatePresence } from "framer-motion";
import { formatDuration } from "@/shared/lib/formatDuration";
import { flowState, type FlowState } from "@/shared/lib/flowState";
import { categoryLabel } from "@/shared/lib/categoryMeta";
import { DayReplayModal } from "./DayReplayModal";

type TrailSide = "left" | "right";

type TrailItem = AttentionEvent & {
  hourLabel: string;
  isHourStart: boolean;
  state: FlowState;
  side: TrailSide;
};

const stateLabels: Record<FlowState, string> = {
  focused: "Focused",
  neutral: "Neutral",
  distracted: "Distracted",
  break: "Break",
};

export function DriftMapView() {
  const { data: events, error, isLoading } = useAttentionSessions();
  // Analytics panel refreshes every 15 min — independent of the live trail sampler.
  const { data: snapshotEvents } = useAttentionSessionsThrottled("daily");
  const [showOnlyDistractions, setShowOnlyDistractions] = useState(false);
  const [replayCursor, setReplayCursor] = useState(100); // 0–100; 100 = live
  const [isPlaying, setIsPlaying] = useState(false);
  const [showReplayModal, setShowReplayModal] = useState(false);
  const trailEndRef = useRef<HTMLDivElement>(null);

  const sessions = useMemo(
    () => [...(events ?? [])].sort(byStartTime),
    [events],
  );

  // Throttled snapshot sorted for analytics
  const snapshotSessions = useMemo(
    () => [...(snapshotEvents ?? [])].sort(byStartTime),
    [snapshotEvents],
  );

  // Time range of all sessions
  const sessionRange = useMemo(() => {
    if (sessions.length === 0) return null;
    return {
      start: new Date(sessions[0].startedAt).getTime(),
      end: new Date(sessions[sessions.length - 1].endedAt).getTime(),
    };
  }, [sessions]);

  // Absolute ms position of the scrubber
  const replayTimeMs = useMemo(() => {
    if (!sessionRange || replayCursor >= 100) return null;
    return sessionRange.start + (replayCursor / 100) * (sessionRange.end - sessionRange.start);
  }, [sessionRange, replayCursor]);

  // Events visible at the current replay position (trail only)
  const replaySessions = useMemo(() => {
    if (replayTimeMs === null) return sessions;
    return sessions.filter((s) => new Date(s.startedAt).getTime() <= replayTimeMs);
  }, [sessions, replayTimeMs]);

  // Snapshot events filtered to replay position (analytics panel)
  const analyticsSnapshot = useMemo(() => {
    if (replayTimeMs === null) return snapshotSessions;
    return snapshotSessions.filter((s) => new Date(s.startedAt).getTime() <= replayTimeMs);
  }, [snapshotSessions, replayTimeMs]);

  const trailItems = useMemo(() => {
    const visible = showOnlyDistractions
      ? replaySessions.filter((e) => flowState(e) === "distracted")
      : replaySessions;
    return buildTrailItems(visible);
  }, [replaySessions, showOnlyDistractions]);

  const analytics = useMemo(() => buildAttentionAnalytics(analyticsSnapshot), [analyticsSnapshot]);

  // Auto-play: advance cursor at ~0.5 % per 60 ms → full replay ≈ 12 s
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setReplayCursor((prev) => {
        if (prev >= 100) { setIsPlaying(false); return 100; }
        return Math.min(100, prev + 0.5);
      });
    }, 60);
    return () => clearInterval(id);
  }, [isPlaying]);

  // Auto-scroll trail to bottom in live mode
  useEffect(() => {
    if (replayCursor >= 100 && trailEndRef.current) {
      trailEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [trailItems.length, replayCursor]);

  return (
    <div className="view-stack">
      <header className="view-header attention-drift-header">
        <div>
          <h1>Today's Cognitive Trail</h1>
          <p>Your attention mapped across every moment of work.</p>
        </div>
      </header>

      <div className="attention-drift-layout">
        <section className="attention-flow-panel">
          <div className="attention-flow-session">
            <div className="header-session-info">
              <div className="header-status-indicator">
                <i />
              </div>
              <div className="header-session-text">
                <h2>Focus Session • {sessionRangeLabel(trailItems)}</h2>
                <p>{trailItems.length > 0 ? `${trailItems.length} attention shifts` : "Waiting for local attention samples"}</p>
              </div>
            </div>
          </div>

          <div className="attention-flow-legend">
            <div className="attention-legend-list">
              {(["focused", "neutral", "distracted", "break"] as FlowState[]).map((state) => (
                <span className={`attention-legend-item attention-legend-${state}`} key={state}>
                  <i />
                  {stateLabels[state]}
                </span>
              ))}
            </div>

            <div className="show-distractions-wrapper">
              <label className="toggle-container" htmlFor="distraction-toggle">
                <span>Show only distractions</span>
                <input
                  checked={showOnlyDistractions}
                  className="toggle-input"
                  id="distraction-toggle"
                  onChange={(event) => setShowOnlyDistractions(event.target.checked)}
                  type="checkbox"
                />
                <div className="toggle-switch" />
              </label>
            </div>
          </div>

          {sessions.length > 0 && (
            <FocusReplayBar
              cursor={replayCursor}
              isPlaying={isPlaying}
              sessionRange={sessionRange}
              replayTimeMs={replayTimeMs}
              onCursorChange={(v) => { setReplayCursor(v); setIsPlaying(false); }}
              onPlayPause={() => setShowReplayModal(true)}
              onLive={() => { setReplayCursor(100); setIsPlaying(false); }}
            />
          )}

          <div className="attention-flow-board">
            {isLoading ? <TrailSkeleton /> : null}
            {!isLoading && error ? (
              <div className="map-empty-state">
                <span className="map-empty-icon">⚠</span>
                <p>{error}</p>
              </div>
            ) : null}
            {!isLoading && !error && trailItems.length === 0 ? (
              <div className="map-empty-state">
                <span className="map-empty-icon">◎</span>
                <p>No attention sessions yet.</p>
                <span className="map-empty-sub">Keep Flint running — your trail will appear here.</span>
              </div>
            ) : null}

            {trailItems.length > 0 ? (
              <div className="attention-trail-list">
                <TrailPathOverlay items={trailItems} />
                {trailItems.map((item) => (
                  <TrailRow item={item} key={item.id} />
                ))}
                <div ref={trailEndRef} style={{ height: 1 }} />
              </div>
            ) : null}
          </div>
        </section>
        <TrailAnalysisRail analytics={analytics} sessions={analyticsSnapshot} replayTimeMs={replayTimeMs} />
      </div>

      <AnimatePresence>
        {showReplayModal && (
          <DayReplayModal
            events={sessions}
            onClose={() => setShowReplayModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TrailAnalysisRail({
  analytics,
  sessions,
  replayTimeMs,
}: {
  analytics: ReturnType<typeof buildAttentionAnalytics>;
  sessions: AttentionEvent[];
  replayTimeMs: number | null;
}) {
  const neutralSeconds = Math.max(0, analytics.activeSeconds - analytics.focusSeconds - analytics.distractionSeconds);
  const breakdown = [
    { key: "focused", label: "Focused", seconds: analytics.focusSeconds, state: "focused" as FlowState },
    { key: "neutral", label: "Neutral", seconds: neutralSeconds, state: "neutral" as FlowState },
    { key: "distracted", label: "Distracted", seconds: analytics.distractionSeconds, state: "distracted" as FlowState },
    { key: "break", label: "Break", seconds: analytics.idleSeconds, state: "break" as FlowState },
  ];
  const topDistractions = topDistractionRows(sessions);
  const sparkline = scoreSparklinePoints(sessions);
  const scoreTimeTicks = scoreSparklineTimeTicks(sessions);
  const minDataMet = analytics.focusScoreBreakdown.minDataMet;
  const scoreTone = analytics.focusScore >= 70 ? "Stable focus" : analytics.focusScore >= 45 ? "Moderate focus" : "Fragmented focus";

  return (
    <aside className="attention-analysis-rail" aria-label="Attention trail analytics">
      <section className="analysis-card">
        <div className="analysis-card-header">
          <h2>Focus Score</h2>
        </div>
        <div className="score-summary">
          <div className="score-summary-value">
            {minDataMet ? (
              <>
                <strong>{analytics.focusScore}</strong>
                <span>/100</span>
              </>
            ) : (
              <strong>—</strong>
            )}
          </div>
          <div className="score-summary-copy">
            {minDataMet ? (
              <>
                <b>{scoreTone}</b>
                <p>You were focused for {percentOf(analytics.focusSeconds, analytics.activeSeconds)} of this session.</p>
              </>
            ) : (
              <p>Score appears after 10 min of active data.</p>
            )}
          </div>
        </div>
        <svg className="score-sparkline" viewBox="0 0 320 72" aria-hidden="true">
          <path className="score-sparkline-grid" d="M 0 8 H 320 M 0 36 H 320 M 0 64 H 320" />
          <polyline className="score-sparkline-line" points={sparkline} fill="none" />
          {scoreTimeTicks.map((tick) => (
            <text className="score-sparkline-time" key={`${tick.label}-${tick.x}`} textAnchor={tick.anchor} x={tick.x} y="70">
              {tick.label}
            </text>
          ))}
        </svg>
      </section>

      <section className="analysis-card">
        <div className="analysis-card-header">
          <h2>Time Breakdown</h2>
          <span>{formatDuration(analytics.totalSeconds)}</span>
        </div>
        <div className="breakdown-content">
          <BreakdownDonut items={breakdown} totalSeconds={analytics.totalSeconds} />
          <div className="breakdown-list">
            {breakdown.map((item) => (
              <div className={`breakdown-row breakdown-${item.state}`} key={item.key}>
                <span>
                  <i />
                  {item.label}
                </span>
                <strong>
                  {formatDuration(item.seconds)} ({percentOf(item.seconds, analytics.totalSeconds)})
                </strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {topDistractions.length > 0 && (
        <>
          <span className="rail-section-label">Top Distractions</span>
          {topDistractions.map((item) => (
            <div className="distraction-row" key={item.display}>
              <span className="distraction-name">{item.display}</span>
              <strong>{formatDuration(item.seconds)}</strong>
            </div>
          ))}
        </>
      )}

      <section className="analysis-card insight-card">
        <span>Insight</span>
        {(() => { const i = trailInsight(analytics); return <><p className="insight-line1">{i.line1}</p><p className="insight-line2">{i.line2}</p></>; })()}
      </section>
    </aside>
  );
}

function BreakdownDonut({
  items,
  totalSeconds,
}: {
  items: Array<{ key: string; seconds: number; state: FlowState }>;
  totalSeconds: number;
}) {
  let offset = 0;

  return (
    <svg className="breakdown-donut" viewBox="0 0 42 42" aria-hidden="true">
      <circle className="breakdown-donut-track" cx="21" cy="21" r="15.915" />
      {items.map((item) => {
        const share = totalSeconds === 0 ? 0 : (item.seconds / totalSeconds) * 100;
        const segment = (
          <circle
            className={`breakdown-donut-segment breakdown-donut-${item.state}`}
            cx="21"
            cy="21"
            key={item.key}
            r="15.915"
            strokeDasharray={`${share} ${100 - share}`}
            strokeDashoffset={-offset}
          />
        );
        offset += share;
        return segment;
      })}
      <circle className="breakdown-donut-hole" cx="21" cy="21" r="9.5" />
    </svg>
  );
}

const ACHIEVEMENT_TIERS: { minSeconds: number; labels: readonly string[] }[] = [
  { minSeconds:  5 * 60, labels: ["Nice Start",  "Good Start",  "Early Focus",  "Getting There"] },
  { minSeconds: 15 * 60, labels: ["Locked In",   "In The Zone", "Dialed In",    "Staying Sharp"] },
  { minSeconds: 30 * 60, labels: ["Deep Work",   "Crushing It", "Flow State",   "On Fire"]       },
  { minSeconds: 60 * 60, labels: ["Peak Focus",  "Legendary",   "Unstoppable",  "Elite Focus"]   },
];

function achievementLabel(durationSeconds: number, seed: string): { label: string; tier: number } | null {
  // Walk tiers from highest to lowest — use the best-matching tier.
  for (let i = ACHIEVEMENT_TIERS.length - 1; i >= 0; i--) {
    if (durationSeconds >= ACHIEVEMENT_TIERS[i].minSeconds) {
      const labels = ACHIEVEMENT_TIERS[i].labels;
      // Deterministic pick so the label doesn't change on re-render.
      const hash = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return { label: labels[hash % labels.length], tier: i + 1 };
    }
  }
  return null;
}

function TrailRow({ item }: { item: TrailItem }) {
  const isStrongFocus = item.state === "focused" && item.durationSeconds >= 15 * 60;
  const isRight = item.side === "right";

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={`attention-trail-row attention-trail-row-${item.side} attention-trail-row-${item.state}`}
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
    >
      <div className={`attention-flow-time-col ${item.isHourStart ? "" : "attention-flow-time-empty"}`}>
        {item.isHourStart ? item.hourLabel : null}
      </div>
      <div className="attention-flow-axis-col">
        <div className="axis-line-segment" />
        <i className={`attention-flow-axis-dot axis-dot-${item.state} ${item.isHourStart ? "axis-dot-large" : ""}`} />
      </div>
      <div className="attention-trail-canvas">
        <div className="trail-card-slot trail-card-slot-left">
          {!isRight ? <TrailCard item={item} isStrongFocus={isStrongFocus} /> : <span className="trail-card-spacer" />}
        </div>
        <div className="trail-connector-slot">
          {isRight ? <span className="trail-branch-time">{formatTime(item.startedAt)}</span> : null}
        </div>
        <div className="trail-card-slot trail-card-slot-right">
          {isRight ? <TrailCard item={item} isStrongFocus={isStrongFocus} /> : <span className="trail-card-spacer" />}
        </div>
      </div>
    </motion.div>
  );
}

function TrailPathOverlay({ items }: { items: TrailItem[] }) {
  const viewBoxWidth = 520;
  const rowHeight = 76;
  const leftCardCenterX = 130;
  const rightIncomingEndX = 136;
  const rightTimestampCenterX = 182;
  const timestampGapY = 13;
  const leftCardTopY = 19;
  const leftCardBottomY = 57;
  const rightCardCenterY = 38;
  const paths = items.slice(0, -1).map((item, index) => {
    const next = items[index + 1];
    const y = index * rowHeight;
    const nextY = (index + 1) * rowHeight;

    if (item.side === "left" && next.side === "right") {
      return {
        d: `M ${leftCardCenterX} ${y + leftCardBottomY} C ${leftCardCenterX} ${y + 72}, ${rightIncomingEndX - 54} ${nextY + rightCardCenterY}, ${rightIncomingEndX} ${nextY + rightCardCenterY}`,
        state: next.state,
      };
    }

    if (item.side === "right" && next.side === "left") {
      return {
        d: `M ${rightTimestampCenterX} ${y + rightCardCenterY + timestampGapY} C ${rightTimestampCenterX} ${y + rightCardCenterY + timestampGapY + 20}, ${leftCardCenterX} ${nextY + leftCardTopY - 28}, ${leftCardCenterX} ${nextY + leftCardTopY - 8}`,
        state: next.state,
      };
    }

    if (item.side === "right" && next.side === "right") {
      return {
        d: `M ${rightTimestampCenterX} ${y + rightCardCenterY + timestampGapY} L ${rightTimestampCenterX} ${nextY + rightCardCenterY - timestampGapY}`,
        state: next.state,
      };
    }

    // left → left
    return {
      d: `M ${leftCardCenterX} ${y + leftCardBottomY} C ${leftCardCenterX} ${y + 72}, ${leftCardCenterX} ${nextY + 4}, ${leftCardCenterX} ${nextY + leftCardTopY - 8}`,
      state: next.state,
    };
  });

  return (
    <svg
      aria-hidden="true"
      className="attention-card-trail-overlay"
      preserveAspectRatio="none"
      viewBox={`0 0 ${viewBoxWidth} ${Math.max(items.length * rowHeight, rowHeight)}`}
    >
      <defs>
        {(["focused", "neutral", "distracted", "break"] as FlowState[]).map((state) => (
          <marker
            id={`attention-trail-arrow-${state}`}
            key={state}
            markerHeight="3"
            markerWidth="3"
            orient="auto"
            refX="2.5"
            refY="1.5"
            viewBox="0 0 3 3"
          >
            <path className={`attention-card-trail-arrow trail-line-${state}`} d="M 0.4 0.4 L 2.5 1.5 L 0.4 2.6" />
          </marker>
        ))}
      </defs>
      {paths.map((path, index) => (
        <path
          className={`attention-card-trail-path trail-line-${path.state}`}
          d={path.d}
          key={`${path.d}-${index}`}
          markerEnd={`url(#attention-trail-arrow-${path.state})`}
        />
      ))}
      {items.map((item, index) =>
        item.side === "left" ? (
          <path
            className={`attention-card-edge-stub trail-line-${item.state}`}
            d={`M ${leftCardCenterX} ${index * rowHeight + leftCardTopY} L ${leftCardCenterX} ${index * rowHeight + leftCardBottomY}`}
            key={`left-stub-${item.id}`}
          />
        ) : null,
      )}
      </svg>
  );
}

function TrailCard({ item, isStrongFocus }: { item: TrailItem; isStrongFocus: boolean }) {
  const displayName = item.appName.startsWith("Google Chrome:") ? item.appName.replace("Google Chrome: ", "") : item.appName;
  const label = item.state === "focused" ? achievementLabel(item.durationSeconds, item.startedAt) : null;

  return (
    <div className={`attention-flow-card flow-card-${item.state} ${isStrongFocus ? "flow-card-strong" : ""}`}>
      <AppIcon name={item.appName} windowTitle={item.windowTitle ?? undefined} state={item.state} />
      <div className="app-card-details">
        <strong>{displayName}</strong>
        <span>{item.windowTitle || categoryLabel(item.category)}</span>
      </div>
      <div className="trail-card-right">
        {label ? <span className={`achievement-badge achievement-tier-${label.tier}`}>{label.label}</span> : null}
        <span className={`duration-badge duration-badge-${item.state}`}>{formatDuration(item.durationSeconds)}</span>
      </div>
    </div>
  );
}

// More specific keys must come before broader ones (e.g. "claude code" before "claude")
const APP_ICON_ENTRIES: [string, string][] = [
  // Claude family — specific before broad
  ["claude code", "/app-icons/claudecode.svg"],
  ["claude", "/app-icons/claude.svg"],
  // Codex — app & CLI
  ["codex cli", "/app-icons/codex.svg"],
  ["codex", "/app-icons/codex.svg"],
  // ChatGPT / OpenAI
  ["chatgpt", "/app-icons/openai.svg"],
  ["chat gpt", "/app-icons/openai.svg"],
  ["openai", "/app-icons/openai.svg"],
  // AI / Dev tools
  ["cursor", "/app-icons/cursor.svg"],
  ["visual studio code", "/app-icons/vscode.svg"],
  ["vscode", "/app-icons/vscode.svg"],
  ["xcode", "/app-icons/xcode.svg"],
  ["zed", "/app-icons/zed.svg"],
  ["iterm2", "/app-icons/iterm2.svg"],
  ["iterm", "/app-icons/iterm2.svg"],
  ["neovim", "/app-icons/neovim.svg"],
  ["nvim", "/app-icons/neovim.svg"],
  ["vim", "/app-icons/vim.svg"],
  // Productivity & PM
  ["notion", "/app-icons/notion.svg"],
  ["obsidian", "/app-icons/obsidian.svg"],
  ["todoist", "/app-icons/todoist.svg"],
  ["things", "/app-icons/things.svg"],
  ["evernote", "/app-icons/evernote.svg"],
  ["linear", "/app-icons/linear.svg"],
  ["jira", "/app-icons/jira.svg"],
  ["trello", "/app-icons/trello.svg"],
  ["airtable", "/app-icons/airtable.svg"],
  ["asana", "/app-icons/asana.svg"],
  // Design
  ["figma", "/app-icons/figma.svg"],
  ["sketch", "/app-icons/sketch.svg"],
  ["framer", "/app-icons/framer.svg"],
  ["webflow", "/app-icons/webflow.svg"],
  ["canva", "/app-icons/canva.svg"],
  // Browsers
  ["google chrome", "/app-icons/googlechrome.svg"],
  ["firefox", "/app-icons/firefox.svg"],
  ["arc", "/app-icons/arc.svg"],
  // Communication
  ["slack", "/app-icons/slack.svg"],
  ["discord", "/app-icons/discord.svg"],
  ["zoom", "/app-icons/zoom.svg"],
  // Social / Entertainment
  ["spotify", "/app-icons/spotify.svg"],
  ["netflix", "/app-icons/netflix.svg"],
  ["prime video", "/app-icons/primevideo.svg"],
  ["amazon prime", "/app-icons/primevideo.svg"],
  ["vlc", "/app-icons/vlc.svg"],
  ["reddit", "/app-icons/reddit.svg"],
  ["instagram", "/app-icons/instagram.svg"],
  ["facebook", "/app-icons/facebook.svg"],
  ["tiktok", "/app-icons/tiktok.svg"],
  ["threads", "/app-icons/threads.svg"],
  ["snapchat", "/app-icons/snapchat.svg"],
  ["pinterest", "/app-icons/pinterest.svg"],
  ["linkedin", "/app-icons/linkedin.svg"],
  // Version control
  ["github", "/app-icons/github.svg"],
  ["git", "/app-icons/git.svg"],
  // Apple system
  ["finder", "/app-icons/apple.svg"],
  ["safari", "/app-icons/apple.svg"],
  ["system preferences", "/app-icons/apple.svg"],
  ["system settings", "/app-icons/apple.svg"],
  // Screenshot
  ["flameshot", "/app-icons/flameshot.svg"],
];

function AppIconImage({ src, className }: { src: string; className: string }) {
  return <img src={src} className={className} alt="" draggable={false} />;
}

// Browser app names that should NOT be used as service identifiers when
// matching site suffixes or window titles.
const BROWSER_KEYS = new Set(["google chrome", "firefox", "arc", "safari"]);

function resolveIconFromText(text: string, skipBrowserKeys: boolean): React.ReactElement | null {
  // Inline SVG icons — checked before the file-icon loop so they always win.
  if (text.includes("youtube")) {
    return (
      <svg className="app-card-icon youtube-logo" fill="currentColor" viewBox="0 0 24 24">
        <rect fill="#FF0000" height="24" rx="6" width="24" />
        <polygon fill="#ffffff" points="10,8 16,12 10,16" />
      </svg>
    );
  }
  if (text.includes("twitter") || text === "x") {
    return (
      <svg className="app-card-icon x-logo" fill="currentColor" viewBox="0 0 24 24">
        <rect fill="#000000" height="24" rx="6" width="24" />
        <path d="M17.5 5h-2.2l-4.5 5.8L7 5H4.8l5.5 7.1L4.5 19H6.7l4.8-6.2L15.3 19h2.2l-5.8-7.5L17.5 5z" fill="#ffffff" />
      </svg>
    );
  }
  if (text.includes("gmail") || text.includes("google mail")) {
    return (
      <svg className="app-card-icon gmail-logo" fill="none" viewBox="0 0 24 24">
        <rect fill="#f1f3f4" height="24" rx="6" width="24" />
        <path d="M5 7v10h2.5v-6.5l4.5 3.2 4.5-3.2V17H19V7h-2.5l-4.5 3.2L7.5 7H5z" fill="#ea4335" />
      </svg>
    );
  }

  for (const [key, src] of APP_ICON_ENTRIES) {
    if (skipBrowserKeys && BROWSER_KEYS.has(key)) continue;
    if (text === key || text.includes(key)) {
      return <AppIconImage src={src} className="app-card-icon" />;
    }
  }
  return null;
}

function AppIcon({ name, windowTitle, state }: { name: string; windowTitle?: string; state: FlowState }) {
  const normName = name.toLowerCase();

  // For "Browser: domain.com" entries, check the site domain first so that
  // e.g. "Google Chrome: youtube.com" resolves to YouTube, not Chrome.
  const colonIdx = normName.indexOf(": ");
  if (colonIdx !== -1) {
    const siteSuffix = normName.slice(colonIdx + 2);
    const icon = resolveIconFromText(siteSuffix, true);
    if (icon) return icon;
  }

  // Check the window title for service names — handles cases where the
  // browser extension didn't enrich the app name but the title is recognisable
  // (e.g. appName "Google Chrome", windowTitle "YouTube").
  if (windowTitle) {
    const normTitle = windowTitle.toLowerCase();
    const icon = resolveIconFromText(normTitle, true);
    if (icon) return icon;
  }

  // Full app-name lookup (original behaviour — handles standalone "YouTube", "ChatGPT", etc.)
  const icon = resolveIconFromText(normName, false);
  if (icon) return icon;

  if (state === "break" || normName.includes("break")) {
    return (
      <svg className="app-card-icon break-logo" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
        <line x1="6" x2="6" y1="2" y2="4" />
        <line x1="10" x2="10" y1="2" y2="4" />
        <line x1="14" x2="14" y1="2" y2="4" />
      </svg>
    );
  }

  const firstLetter = name ? name.substring(0, 1).toUpperCase() : "?";
  let fallbackBg = "rgba(255, 255, 255, 0.08)";
  let fallbackColor = "var(--color-text-muted)";

  if (state === "focused") {
    fallbackBg = "rgba(110, 231, 133, 0.15)";
    fallbackColor = "var(--color-recovery-green)";
  } else if (state === "distracted") {
    fallbackBg = "rgba(255, 159, 69, 0.15)";
    fallbackColor = "var(--color-drift-orange)";
  }

  return (
    <div className="app-card-icon fallback-logo" style={{ background: fallbackBg, color: fallbackColor }}>
      {firstLetter}
    </div>
  );
}

function buildTrailItems(events: AttentionEvent[]): TrailItem[] {
  let activeHour: string | null = null;

  return events.map((event) => {
    const hour = hourKey(event.startedAt);
    const isHourStart = hour !== activeHour;
    activeHour = hour;

    return {
      ...event,
      hourLabel: formatHour(event.startedAt),
      isHourStart,
      state: flowState(event),
      side: isHourStart ? "left" : "right",
    };
  });
}


function sessionRangeLabel(items: TrailItem[]) {
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    return "Waiting for local attention samples";
  }

  return `${formatTime(first.startedAt)} - ${formatTime(last.endedAt)}`;
}


function scoreSparklinePoints(events: AttentionEvent[]) {
  const plot = { left: 0, right: 320, top: 8, bottom: 64 };

  if (events.length === 0) {
    return `${plot.left},${plot.bottom} ${plot.right},${plot.bottom}`;
  }

  // Single O(n) pass — running totals, no per-slice buildAttentionAnalytics calls.
  let focusSeconds = 0;
  let activeSeconds = 0;
  const scorePerEvent = events.map((event) => {
    if (!event.isIdle) {
      activeSeconds += event.durationSeconds;
      if (isFocusCategory(event.category)) {
        focusSeconds += event.durationSeconds;
      }
    }
    if (activeSeconds === 0) return 0;
    return Math.min(100, Math.max(0, Math.round((focusSeconds / activeSeconds) * 90 + 10)));
  });

  const maxPoints = 18;
  const step = Math.max(1, Math.ceil(events.length / maxPoints));
  const indices = events
    .map((_, i) => i)
    .filter((i) => i % step === 0);
  const pts = indices.length > 1 ? indices : [0];

  return pts
    .map((eventIndex, ptIndex) => {
      const score = scorePerEvent[eventIndex] ?? 0;
      const x = pts.length === 1 ? plot.left : plot.left + (ptIndex / (pts.length - 1)) * (plot.right - plot.left);
      const y = plot.bottom - (score / 100) * (plot.bottom - plot.top);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function scoreSparklineTimeTicks(events: AttentionEvent[]) {
  const plot = { left: 0, mid: 160, right: 320 };

  if (events.length === 0) {
    return [
      { anchor: "start" as const, label: "12:00 AM", x: plot.left },
      { anchor: "middle" as const, label: "12:00 PM", x: plot.mid },
      { anchor: "end" as const, label: "11:59 PM", x: plot.right },
    ];
  }

  const first = events[0];
  const middle = events[Math.floor(events.length / 2)];
  const last = events[events.length - 1];
  const durationMs = new Date(last.endedAt).getTime() - new Date(first.startedAt).getTime();

  if (durationMs < 4 * 60 * 60 * 1000) {
    return [
      { anchor: "start" as const, label: formatTime(first.startedAt), x: plot.left },
      { anchor: "end" as const, label: formatTime(last.endedAt), x: plot.right },
    ];
  }

  return [
    { anchor: "start" as const, label: formatTime(first.startedAt), x: plot.left },
    { anchor: "middle" as const, label: formatTime(middle.startedAt), x: plot.mid },
    { anchor: "end" as const, label: formatTime(last.endedAt), x: plot.right },
  ];
}

function topDistractionRows(events: AttentionEvent[]) {
  const totals = new Map<string, { display: string; seconds: number }>();

  events.forEach((event) => {
    if (!isDistractionCategory(event.category) || event.isIdle) {
      return;
    }

    const title = event.windowTitle?.trim();
    const appDisplay = event.appName.includes(": ") ? event.appName.slice(event.appName.indexOf(": ") + 2) : event.appName;
    const hasDistinctTitle = title && title.toLowerCase() !== appDisplay.toLowerCase();
    const key = hasDistinctTitle ? `${appDisplay}::${title}` : appDisplay;
    const display = hasDistinctTitle ? `${appDisplay}: ${title}` : appDisplay;
    const prev = totals.get(key);
    totals.set(key, { display, seconds: (prev?.seconds ?? 0) + event.durationSeconds });
  });

  return Array.from(totals.values())
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3);
}

function trailInsight(analytics: ReturnType<typeof buildAttentionAnalytics>): { line1: string; line2: string } {
  if (analytics.totalSeconds === 0) {
    return {
      line1: "Waiting for attention data.",
      line2: "Keep Flint running to build your trail.",
    };
  }

  if (analytics.fragmentationLevel === "high") {
    return {
      line1: `Distraction drift at ${Math.round(analytics.driftTransitionsPerHour)}× per hour.`,
      line2: "Protect the next focus window before switching again.",
    };
  }

  if (analytics.mostDistractingApp) {
    return {
      line1: `Most distraction came from ${analytics.mostDistractingApp}.`,
      line2: "Watch for that drift source in the next session.",
    };
  }

  if (analytics.strongestFocusHour !== null) {
    return {
      line1: `Strongest focus started around ${formatHourLabel(analytics.strongestFocusHour)}.`,
      line2: "Guard that window — it's your peak clarity period.",
    };
  }

  return {
    line1: "Attention path is relatively stable today.",
    line2: "Keep the strongest focus windows protected.",
  };
}

function formatHourLabel(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(date);
}

function percentOf(value: number, total: number) {
  if (total <= 0) {
    return "0%";
  }

  return `${Math.round((value / total) * 100)}%`;
}


function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatHour(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).format(new Date(value));
}

function hourKey(value: string) {
  const date = new Date(value);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

function byStartTime(left: AttentionEvent, right: AttentionEvent) {
  return new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime();
}

function FocusReplayBar({
  cursor,
  isPlaying,
  sessionRange,
  replayTimeMs,
  onCursorChange,
  onPlayPause,
  onLive,
}: {
  cursor: number;
  isPlaying: boolean;
  sessionRange: { start: number; end: number } | null;
  replayTimeMs: number | null;
  onCursorChange: (v: number) => void;
  onPlayPause: () => void;
  onLive: () => void;
}) {
  const isLive = cursor >= 100;
  const timeLabel = replayTimeMs
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(replayTimeMs))
    : sessionRange
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(sessionRange.end))
      : "Now";

  return (
    <div className="replay-bar">
      <button
        aria-label="Play day recap"
        className="replay-play-btn"
        onClick={onPlayPause}
        type="button"
      >
        ▶
      </button>
      <input
        aria-label="Replay scrubber"
        className="replay-scrubber"
        max={100}
        min={0}
        step={0.1}
        type="range"
        value={cursor}
        onChange={(e) => onCursorChange(Number(e.target.value))}
      />
      <span className="replay-time-label">{timeLabel}</span>
      {!isLive && (
        <button className="replay-live-btn" onClick={onLive} type="button">
          Live
        </button>
      )}
    </div>
  );
}

function TrailSkeleton() {
  return (
    <div className="trail-skeleton" aria-busy="true" aria-label="Loading attention trail">
      {[72, 55, 80, 45, 65].map((w, i) => (
        <div className="trail-skeleton-row" key={i}>
          <div className="trail-skeleton-dot" />
          <div className="trail-skeleton-card" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
