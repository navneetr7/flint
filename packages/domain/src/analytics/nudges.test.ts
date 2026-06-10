import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildSmartNudges } from "./nudges";

describe("smart nudges", () => {
  it("surfaces active drift when the latest session is sustained distraction", () => {
    const nudges = buildSmartNudges([
      event("1", "Code", "development", 600),
      event("2", "YouTube", "entertainment", 6 * 60),
    ]);

    expect(nudges[0]).toMatchObject({
      id: "active-drift",
      tone: "drift",
    });
  });

  it("surfaces focus streaks for sustained focus", () => {
    const nudges = buildSmartNudges([event("1", "Code", "development", 26 * 60)]);

    expect(nudges[0]).toMatchObject({
      id: "focus-streak",
      tone: "focus",
    });
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
