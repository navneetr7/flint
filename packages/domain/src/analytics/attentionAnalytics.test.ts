import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildAttentionAnalytics, buildRealityCheckInsights } from "./attentionAnalytics";

describe("attention analytics", () => {
  it("detects deep work, drift, idle time, and recovery", () => {
    const events: AttentionEvent[] = [
      event("1", "Code", "development", 30 * 60),
      event("2", "YouTube", "entertainment", 10 * 60),
      event("3", "Code", "development", 20 * 60),
      event("4", "Idle", "system", 5 * 60, true),
    ];

    const analytics = buildAttentionAnalytics(events);

    expect(analytics.deepWorkSessions).toBe(2);
    expect(analytics.driftCount).toBe(1);
    expect(analytics.idleSeconds).toBe(5 * 60);
    expect(analytics.longestRecoverySeconds).toBe(5 * 60);
    expect(analytics.totalRecoverySeconds).toBe(5 * 60);
    expect(analytics.averageRecoverySeconds).toBe(5 * 60);
    expect(analytics.appSwitches).toBe(2);
    expect(analytics.averageFocusSessionSeconds).toBe(25 * 60);
    expect(analytics.longestDeepWorkSession?.appName).toBe("Code");
    expect(analytics.mostDistractingApp).toBe("YouTube");
    expect(analytics.focusScoreBreakdown.focusedSeconds).toBe(50 * 60);
    expect(analytics.focusScoreBreakdown.driftSeconds).toBe(10 * 60);
    expect(analytics.focusScoreBreakdown.deepWorkFloor).toBeGreaterThan(0);
    expect(analytics.focusScoreBreakdown.driftPenalty).toBeGreaterThan(0);
    expect(analytics.focusScoreBreakdown.score).toBe(analytics.focusScore);
  });

  it("treats learning as focused time", () => {
    const events: AttentionEvent[] = [
      event("1", "Arc: YouTube", "learning", 20 * 60),
      event("2", "Code", "development", 10 * 60),
    ];

    const analytics = buildAttentionAnalytics(events);

    expect(analytics.focusSeconds).toBe(30 * 60);
    expect(analytics.deepWorkSessions).toBe(1);
    expect(analytics.driftSeconds).toBe(0);
  });

  it("does not flag normal workflow switching as fragmented", () => {
    // editor↔terminal↔browser research is productive, not fragmentation
    const events: AttentionEvent[] = [
      event("1", "Code", "development", 60),
      event("2", "Terminal", "development", 30),
      event("3", "Arc: Docs", "browser", 90),
      event("4", "Code", "development", 60),
      event("5", "Slack", "communication", 60),
      event("6", "Code", "development", 60),
    ];

    const analytics = buildAttentionAnalytics(events);

    expect(analytics.driftTransitionCount).toBe(0);
    expect(analytics.fragmentationLevel).toBe("low");
  });

  it("labels high fragmentation only when drift transitions are frequent", () => {
    // rapid cycling into entertainment = genuine fragmentation
    const events: AttentionEvent[] = [
      event("1", "Code", "development", 60),
      event("2", "YouTube", "entertainment", 60),
      event("3", "Code", "development", 60),
      event("4", "YouTube", "entertainment", 60),
      event("5", "Code", "development", 60),
      event("6", "YouTube", "entertainment", 60),
      event("7", "Code", "development", 60),
      event("8", "YouTube", "entertainment", 60),
    ];

    const analytics = buildAttentionAnalytics(events);

    expect(analytics.driftTransitionsPerHour).toBeGreaterThan(4);
    expect(analytics.fragmentationLevel).toBe("high");
  });

  it("builds rule-based insights from analytics", () => {
    const events: AttentionEvent[] = [
      event("1", "Code", "development", 30 * 60),
      event("2", "Idle", "system", 60, true),
    ];

    expect(buildRealityCheckInsights(events)).toEqual(
      expect.arrayContaining(["1 deep work session detected."]),
    );
  });
});

function event(
  id: string,
  appName: string,
  category: AttentionEvent["category"],
  durationSeconds: number,
  isIdle = false,
): AttentionEvent {
  return {
    id,
    appName,
    category,
    startedAt: "2026-05-29T09:00:00+05:30",
    endedAt: "2026-05-29T09:00:00+05:30",
    durationSeconds,
    isIdle,
  };
}
