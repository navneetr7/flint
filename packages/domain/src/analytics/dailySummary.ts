import type { AttentionEvent } from "../attention/types";
import { buildAttentionAnalytics } from "./attentionAnalytics";

export type DailySummary = {
  headline: string;
  subhead: string;
  topInsight: string | null;
  recentPath: string[];
  focusBalancePercent: number;
};

export function buildDailySummary(events: AttentionEvent[]): DailySummary {
  const analytics = buildAttentionAnalytics(events);
  const focusBalancePercent =
    analytics.activeSeconds === 0 ? 0 : Math.round((analytics.focusSeconds / analytics.activeSeconds) * 100);
  const recentPath = events
    .filter((event) => !event.isIdle)
    .map((event) => event.appName)
    .filter((appName, index, apps) => appName !== apps[index - 1])
    .slice(-5);

  if (events.length === 0) {
    return {
      headline: "No attention data yet.",
      subhead: "Run the desktop app and keep tracking enabled to start collecting local sessions.",
      topInsight: null,
      recentPath,
      focusBalancePercent,
    };
  }

  return {
    headline: headlineForScore(analytics.focusScore),
    subhead: subheadForAnalytics(analytics.deepWorkSessions, analytics.driftCount),
    topInsight: topInsight(events),
    recentPath,
    focusBalancePercent,
  };
}

function headlineForScore(score: number) {
  if (score >= 75) {
    return "Your attention is stable.";
  }

  if (score >= 45) {
    return "Your attention is mixed.";
  }

  return "Your attention is fragmented.";
}

function subheadForAnalytics(deepWorkSessions: number, driftCount: number) {
  if (deepWorkSessions > 0 && driftCount === 0) {
    return "Deep work dominated the latest recording window.";
  }

  if (deepWorkSessions > 0) {
    return "Deep work appeared alongside some attention drift.";
  }

  if (driftCount > 0) {
    return "Drift appeared before a sustained focus session formed.";
  }

  return "Flint is building a local picture of focus, switching, and recovery.";
}

function topInsight(events: AttentionEvent[]) {
  const latest = events.at(-1);

  if (!latest) {
    return null;
  }

  if (latest.isIdle) {
    return "The latest recorded state is idle.";
  }

  return `Latest session: ${latest.appName} for ${Math.max(1, Math.round(latest.durationSeconds / 60))} minutes.`;
}
