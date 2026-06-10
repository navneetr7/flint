import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildHourlyRhythm } from "./hourlyRhythm";

describe("hourly rhythm", () => {
  it("groups focus, drift, idle, and active seconds by start hour", () => {
    const buckets = buildHourlyRhythm([
      event("1", "Code", "development", 600, "2026-05-29T09:00:00+05:30"),
      event("2", "YouTube", "entertainment", 120, "2026-05-29T09:20:00+05:30"),
      event("3", "Idle", "system", 60, "2026-05-29T10:00:00+05:30", true),
    ]);

    expect(buckets[9]).toMatchObject({
      focusSeconds: 600,
      driftSeconds: 120,
      activeSeconds: 720,
    });
    expect(buckets[10]).toMatchObject({
      idleSeconds: 60,
      activeSeconds: 0,
    });
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
