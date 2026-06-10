import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildFocusReport } from "./focusReports";

describe("focus reports", () => {
  it("builds daily, weekly, and monthly focus buckets", () => {
    const events = [
      event("1", "Code", "development", 600, "2026-05-29T09:00:00+05:30"),
      event("2", "YouTube", "entertainment", 300, "2026-05-29T10:00:00+05:30"),
      event("3", "Idle", "system", 120, "2026-05-30T09:00:00+05:30", true),
    ];

    const daily = buildFocusReport(events, "daily");
    const weekly = buildFocusReport(events, "weekly");
    const monthly = buildFocusReport(events, "monthly");

    expect(daily.buckets).toHaveLength(24);
    expect(weekly.buckets).toHaveLength(7);
    expect(monthly.buckets).toHaveLength(31);
    expect(daily.buckets[9].focusSeconds).toBe(600);
    expect(daily.buckets[10].driftSeconds).toBe(300);
    expect(weekly.strongestBucket?.label).toBe("Fri");
    expect(monthly.buckets[28].focusSeconds).toBe(600);
  });
});

function event(
  id: string,
  appName: string,
  category: AttentionEvent["category"],
  durationSeconds: number,
  startedAt: string,
  isIdle = false,
): AttentionEvent {
  return {
    id,
    appName,
    category,
    startedAt,
    endedAt: startedAt,
    durationSeconds,
    isIdle,
  };
}
