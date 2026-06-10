import { useMemo, useState } from "react";
import {
  buildAttentionAnalytics,
  buildFocusReport,
  isFocusCategory,
  isDistractionCategory,
  type AppCategory,
  type FocusReportBucket,
  type ReportRange,
} from "@flint/domain";
import { MetricTile } from "@/shared/components/MetricTile";
import { useAttentionSessionsThrottled } from "@/shared/hooks/useAttentionSessions";
import { formatDuration } from "@/shared/lib/formatDuration";
import { categoryLabel, categoryColor } from "@/shared/lib/categoryMeta";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Flame,
  Award,
  Layers,
  Compass,
} from "lucide-react";

const reportRanges: ReportRange[] = ["daily", "weekly", "monthly"];

export function ReportsView() {
  const [activeRange, setActiveRange] = useState<ReportRange>("daily");
  const { data: events, error, isLoading } = useAttentionSessionsThrottled(activeRange);

  const sessions = events ?? [];

  // 1. Build Focus Report for active range
  const report = useMemo(
    () => buildFocusReport(sessions, activeRange),
    [activeRange, sessions],
  );

  // 2. Build general Attention Analytics
  const analytics = useMemo(
    () => buildAttentionAnalytics(sessions),
    [sessions],
  );

  const maxSeconds = Math.max(
    ...report.buckets.map((b: FocusReportBucket) => b.focusSeconds + b.driftSeconds + b.idleSeconds),
    1,
  );

  // Fixed ceiling so Y-axis always shows a clean scale regardless of data max.
  // Daily buckets are hourly so cap at 60m minimum; weekly/monthly cap at nearest hour.
  const yAxisCeiling = activeRange === "daily"
    ? Math.max(3600, Math.ceil(maxSeconds / 600) * 600)
    : Math.max(3600, Math.ceil(maxSeconds / 3600) * 3600);

  const yAxisTicks: string[] = activeRange === "daily"
    ? ["60m", "45m", "30m", "15m", "0"]
    : [yAxisCeiling, yAxisCeiling * 0.75, yAxisCeiling * 0.5, yAxisCeiling * 0.25, 0].map((s) =>
        s === 0 ? "0" : s >= 3600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 60)}m`,
      );

  const hasData = report.buckets.some(
    (b: FocusReportBucket) => b.focusSeconds > 0 || b.driftSeconds > 0 || b.idleSeconds > 0,
  );

  // 3. Calculate Cognitive Domains (Proportional distributions of active time)
  const categoriesList = useMemo(() => {
    const categorySeconds: Record<string, number> = {};
    let activeTotal = 0;

    sessions.forEach((ev) => {
      if (ev.isIdle) return;
      const cat = ev.category ?? "unknown";
      categorySeconds[cat] = (categorySeconds[cat] ?? 0) + ev.durationSeconds;
      activeTotal += ev.durationSeconds;
    });

    return Object.keys(categorySeconds).map((key) => {
      const cat = key as AppCategory;
      const sec = categorySeconds[key] ?? 0;
      return {
        name: key,
        label: categoryLabel(cat),
        seconds: sec,
        percent: activeTotal > 0 ? Math.round((sec / activeTotal) * 100) : 0,
        color: categoryColor(cat),
      };
    }).sort((a, b) => b.seconds - a.seconds);
  }, [sessions]);

  const totalActiveSeconds = useMemo(
    () => categoriesList.reduce((sum, item) => sum + item.seconds, 0),
    [categoriesList],
  );

  // 4. Calculate core Focus Anchors vs Distraction Drifts ledgers (Top 3)
  const { topAnchors, topDrifts } = useMemo(() => {
    const anchorsMap: Record<string, number> = {};
    const driftsMap: Record<string, number> = {};

    sessions.forEach((ev) => {
      if (ev.isIdle) return;
      if (isFocusCategory(ev.category)) {
        anchorsMap[ev.appName] = (anchorsMap[ev.appName] ?? 0) + ev.durationSeconds;
      } else if (isDistractionCategory(ev.category)) {
        driftsMap[ev.appName] = (driftsMap[ev.appName] ?? 0) + ev.durationSeconds;
      }
    });

    const sortAndSlice = (obj: Record<string, number>) =>
      Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, sec]) => ({ name, seconds: sec }));

    return {
      topAnchors: sortAndSlice(anchorsMap),
      topDrifts: sortAndSlice(driftsMap),
    };
  }, [sessions]);

  // Aggregate Range details
  const driftRatio = totalActiveSeconds > 0
    ? Math.round(
        (sessions.reduce(
          (sum, ev) =>
            !ev.isIdle && isDistractionCategory(ev.category)
              ? sum + ev.durationSeconds
              : sum,
          0,
        ) /
          totalActiveSeconds) *
          100,
      )
    : 0;

  return (
    <div className="view-stack reports-view-stack">
      <header className="view-header">
        <h1>Reports</h1>
        <p>A deep retrospective of focus balance, rhythm patterns, and cognitive domains.</p>
      </header>

      {isLoading ? (
        <p className="muted-status">Building focus reports...</p>
      ) : error ? (
        <p className="error-status">{error}</p>
      ) : !hasData ? (
        <p className="muted-status">Waiting for Flint records to accumulate local sessions.</p>
      ) : (
        <div className="reports-grid">
            {/* Top row: Summary Dashboard cards */}
            <div className="reports-summary-row">
              {/* Circular Dial Dial card */}
              <div className="reports-dial-card">
                <div className="reports-dial-container">
                  <svg className="reports-dial-svg" viewBox="0 0 120 120">
                    <circle className="dial-track" cx="60" cy="60" r="48" />
                    <motion.circle
                      className="dial-value"
                      cx="60"
                      cy="60"
                      r="48"
                      strokeDasharray="301.6"
                      initial={{ strokeDashoffset: 301.6 }}
                      animate={{ strokeDashoffset: 301.6 - (301.6 * report.focusBalancePercent) / 100 }}
                      transition={{ duration: 1, ease: "easeOut" }}
                    />
                  </svg>
                  <div className="dial-label-content">
                    <strong>{report.focusBalancePercent}%</strong>
                  </div>
                </div>
                <div className="dial-desc">
                  <h4>Cognitive Balance</h4>
                  <p>
                    Your development, design, and learning efforts comprised{" "}
                    <strong>{report.focusBalancePercent}%</strong> of active screen attention.
                  </p>
                </div>
              </div>

              {/* Metric Cards Grid */}
              <div className="reports-stats-grid">
                <MetricTile
                  label="Average Focus"
                  value={`${analytics.focusScore}`}
                />
                <MetricTile
                  label="Active screen"
                  value={formatDuration(totalActiveSeconds)}
                  tone="recovery"
                />
                <MetricTile
                  label="Inactivity"
                  value={formatDuration(report.buckets.reduce((s: number, b: any) => s + b.idleSeconds, 0))}
                  tone="drift"
                />
                <MetricTile
                  label="Drift Ratio"
                  value={`${driftRatio}%`}
                  tone={driftRatio > 35 ? "drift" : "focus"}
                />
              </div>
            </div>

            {/* Rhythm Heatmap Grid */}
            <section className="heatmap-panel reports-rhythm-panel" aria-label="Retrospective rhythms">
              <div className="heatmap-panel-header">
                <div className="reports-header-group">
                  <TrendingUp size={16} className="text-cyan" />
                  <h3>Attention Rhythm</h3>
                </div>

                <div className="heatmap-tabs">
                  {reportRanges.map((range) => (
                    <button
                      className={range === activeRange ? "heatmap-tab-active" : ""}
                      key={range}
                      type="button"
                      onClick={() => setActiveRange(range)}
                    >
                      {rangeLabel(range)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="heatmap-legend" aria-hidden="true" style={{ marginTop: 0 }}>
                <span className="legend-focus">Focus</span>
                <span className="legend-drift">Drift</span>
                <span className="legend-idle">Idle</span>
              </div>

              <div className="rhythm-chart-wrapper">
                <div className="rhythm-y-axis">
                  {yAxisTicks.map((tick) => (
                    <span key={tick} className="rhythm-y-tick">{tick}</span>
                  ))}
                </div>
                <div className="rhythm-chart-area">
                  <div
                    className="hourly-rhythm-grid"
                    style={{
                      gridTemplateColumns: `repeat(${report.buckets.length}, minmax(0, 1fr))`,
                      gap: activeRange === "monthly" ? "3px" : undefined,
                    }}
                  >
                    {report.buckets.map((bucket: FocusReportBucket, idx: number) => (
                      <RhythmBar
                        bucket={bucket}
                        key={bucket.label}
                        maxSeconds={yAxisCeiling}
                        showLabel={shouldShowLabel(idx, activeRange)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Bottom Row split layout: Category distributions vs Ledger Anchors */}
            <div className="reports-split-row">
              {/* Cognitive Domains share */}
              <div className="side-panel-card reports-domains-card">
                <div className="side-panel-header">
                  <Layers size={16} className="text-teal" />
                  <h3>Cognitive Domains</h3>
                </div>

                <div className="reports-distribution-container">
                  <div className="reports-distribution-bar">
                    {categoriesList.map((cat) => {
                      if (cat.seconds === 0) return null;
                      const widthPercent = (cat.seconds / totalActiveSeconds) * 100;
                      return (
                        <div
                          key={cat.name}
                          className="distribution-segment"
                          style={{
                            width: `${widthPercent}%`,
                            backgroundColor: cat.color,
                          }}
                          title={`${cat.label}: ${formatDuration(cat.seconds)} (${cat.percent}%)`}
                        />
                      );
                    })}
                  </div>

                  <div className="reports-domains-list">
                    {categoriesList.map((cat) => {
                      if (cat.seconds === 0) return null;
                      return (
                        <div className="reports-domain-row" key={cat.name}>
                          <div className="domain-name-group">
                            <span className="domain-color-dot" style={{ backgroundColor: cat.color }} />
                            <span>{cat.label}</span>
                          </div>
                          <div className="domain-values-group">
                            <strong>{formatDuration(cat.seconds)}</strong>
                            <small>{cat.percent}%</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Anchors & Drifts Ledger */}
              <div className="side-panel-card reports-ledgers-card">
                <div className="side-panel-header">
                  <Award size={16} className="text-orange" />
                  <h3>Retrospective Ledger</h3>
                </div>

                <div className="reports-ledgers-split">
                  {/* Top Anchors */}
                  <div className="reports-ledger-col">
                    <h4>
                      <Flame size={13} className="text-cyan" />
                      <span>Focus Anchors</span>
                    </h4>
                    <div className="ledger-rows-list">
                      {topAnchors.length === 0 ? (
                        <p className="ledger-empty">No focus apps logged.</p>
                      ) : (
                        topAnchors.map((item, index) => {
                          const maxAnchorSec = topAnchors[0]?.seconds || 1;
                          const widthRatio = (item.seconds / maxAnchorSec) * 100;
                          return (
                            <div className="ledger-row-block" key={item.name}>
                              <div className="ledger-row-text">
                                <span className="ledger-rank">{String(index + 1).padStart(2, "0")}</span>
                                <span className="ledger-row-name" title={item.name}>
                                  {item.name}
                                </span>
                                <strong>{formatDuration(item.seconds)}</strong>
                              </div>
                              <div className="ledger-row-progress-track">
                                <div
                                  className="ledger-row-progress-fill bg-cyan"
                                  style={{ width: `${widthRatio}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Top Drifts */}
                  <div className="reports-ledger-col">
                    <h4>
                      <Compass size={13} className="text-orange" />
                      <span>Attention Drifts</span>
                    </h4>
                    <div className="ledger-rows-list">
                      {topDrifts.length === 0 ? (
                        <p className="ledger-empty">No distraction sources.</p>
                      ) : (
                        topDrifts.map((item, index) => {
                          const maxDriftSec = topDrifts[0]?.seconds || 1;
                          const widthRatio = (item.seconds / maxDriftSec) * 100;
                          return (
                            <div className="ledger-row-block" key={item.name}>
                              <div className="ledger-row-text">
                                <span className="ledger-rank">{String(index + 1).padStart(2, "0")}</span>
                                <span className="ledger-row-name" title={item.name}>
                                  {item.name}
                                </span>
                                <strong>{formatDuration(item.seconds)}</strong>
                              </div>
                              <div className="ledger-row-progress-track">
                                <div
                                  className="ledger-row-progress-fill bg-orange"
                                  style={{ width: `${widthRatio}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}

function RhythmBar({
  bucket,
  maxSeconds,
  showLabel,
}: {
  bucket: FocusReportBucket;
  maxSeconds: number;
  showLabel: boolean;
}) {
  const totalSeconds = bucket.focusSeconds + bucket.driftSeconds + bucket.idleSeconds;
  const height = Math.max((totalSeconds / maxSeconds) * 100, totalSeconds > 0 ? 6 : 0);

  return (
    <div className="hourly-rhythm-item">
      <div className="hourly-rhythm-bar" style={{ height: `${height}%` }}>
        <span
          className="hourly-segment hourly-focus"
          style={{ flexGrow: bucket.focusSeconds }}
          title={`Focus ${formatDuration(bucket.focusSeconds)}`}
        />
        <span
          className="hourly-segment hourly-drift"
          style={{ flexGrow: bucket.driftSeconds }}
          title={`Drift ${formatDuration(bucket.driftSeconds)}`}
        />
        <span
          className="hourly-segment hourly-idle"
          style={{ flexGrow: bucket.idleSeconds }}
          title={`Idle ${formatDuration(bucket.idleSeconds)}`}
        />
      </div>
      {showLabel ? <time>{bucket.label}</time> : <time aria-hidden="true" />}
    </div>
  );
}

function shouldShowLabel(idx: number, range: ReportRange): boolean {
  if (range === "monthly") return idx % 5 === 0;
  return true;
}

function rangeLabel(range: ReportRange) {
  return range[0].toUpperCase() + range.slice(1);
}
