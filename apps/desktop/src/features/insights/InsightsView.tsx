import {
  buildRealityCheckInsights,
  buildSmartNudges,
  buildBehavioralNarrative,
} from "@flint/domain";
import { useAttentionSessions } from "@/shared/hooks/useAttentionSessions";
import { useMemo } from "react";

export function InsightsView() {
  const { data: events, error, isLoading } = useAttentionSessions();

  const sessions = events ?? [];
  const narrative = useMemo(() => buildBehavioralNarrative(sessions), [sessions]);
  const nudges = useMemo(() => buildSmartNudges(sessions), [sessions]);
  const realityChecks = useMemo(() => buildRealityCheckInsights(sessions), [sessions]);

  return (
    <div className="view-stack insights-view-stack">
      <header className="view-header">
        <h1>Today's Insights</h1>
        <p>How your focus went today</p>
      </header>

      {isLoading ? (
        <p className="muted-status">Compiling your focus narrative...</p>
      ) : error ? (
        <p className="error-status">{error}</p>
      ) : (
        <div className="insights-scroll-container">
          <div className="insights-layout">
            <div className="side-panel-card">
              <div className="side-metrics-grid">
                <div className="side-metric-tile side-metric-weather">
                  <div className="side-metric-indicator" />
                  <p><strong>{narrative.weather.label}</strong> — {narrative.weather.description}</p>
                </div>
                {realityChecks.slice(0, 5).map((check: string, index: number) => (
                  <div className="side-metric-tile" key={index}>
                    <div className="side-metric-indicator" />
                    <p>{check}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
