import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildDriftTransitions } from "./transitions";

describe("drift transitions", () => {
  it("counts repeated app transitions and averages target duration", () => {
    const transitions = buildDriftTransitions([
      event("1", "Code", "development", 60),
      event("2", "YouTube", "entertainment", 120),
      event("3", "Code", "development", 60),
      event("4", "YouTube", "entertainment", 240),
    ]);

    expect(transitions).toContainEqual({
      fromApp: "Code",
      toApp: "YouTube",
      fromCategory: "development",
      toCategory: "entertainment",
      kind: "drift",
      count: 2,
      averageDurationSeconds: 180,
    });
  });

  it("labels recovery transitions", () => {
    const transitions = buildDriftTransitions([
      event("1", "YouTube", "entertainment", 120),
      event("2", "Code", "development", 600),
    ]);

    expect(transitions[0]?.kind).toBe("recovery");
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
