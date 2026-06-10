import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildDailySummary } from "./dailySummary";

describe("daily summary", () => {
  it("returns an empty state without events", () => {
    expect(buildDailySummary([])).toMatchObject({
      headline: "No attention data yet.",
      recentPath: [],
      focusBalancePercent: 0,
    });
  });

  it("builds a recent path and latest-session insight", () => {
    const summary = buildDailySummary([
      event("1", "Code", "development", 1800),
      event("2", "YouTube", "entertainment", 300),
      event("3", "Code", "development", 600),
    ]);

    expect(summary.recentPath).toEqual(["Code", "YouTube", "Code"]);
    expect(summary.topInsight).toBe("Latest session: Code for 10 minutes.");
  });
});

function event(
  id: string,
  appName: string,
  category: AttentionEvent["category"],
  durationSeconds: number,
): AttentionEvent {
  return {
    id,
    appName,
    category,
    startedAt: "2026-05-29T09:00:00+05:30",
    endedAt: "2026-05-29T09:00:00+05:30",
    durationSeconds,
    isIdle: false,
  };
}
