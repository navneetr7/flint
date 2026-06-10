import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "../attention/types";
import { buildBehavioralNarrative } from "./narrativeReport";

describe("behavioral narrative report", () => {
  it("generates an empty-state report when there are no events", () => {
    const report = buildBehavioralNarrative([]);
    expect(report.title).toBe("Nothing yet today");
    expect(report.weather.label).toBe("No data");
    expect(report.weather.tone).toBe("calm");
    expect(report.chapters).toHaveLength(1);
    expect(report.chapters[0].title).toBe("Waiting for data");
  });

  it("generates a strong focus report for highly focused sessions", () => {
    const report = buildBehavioralNarrative([
      event("1", "VS Code", "development", 3600),
    ]);

    expect(report.title).toBe("Strong focus day");
    expect(report.weather.label).toBe("In the zone");
    expect(report.weather.tone).toBe("focus");
    expect(report.chapters).toHaveLength(3);
    expect(report.chapters[0].title).toBe("How your day looked");
    expect(report.chapters[1].title).toBe("Focus vs. distraction");
    expect(report.chapters[2].title).toBe("Your best window");
  });

  it("generates an off-track report for high drift sessions", () => {
    const events: AttentionEvent[] = [];
    for (let i = 0; i < 40; i++) {
      events.push(event(String(i), i % 2 === 0 ? "YouTube" : "Twitter", "entertainment", 60));
    }
    const report = buildBehavioralNarrative(events);

    expect(report.title).toBe("Rough day");
    expect(report.weather.label).toBe("Off track");
    expect(report.weather.tone).toBe("drift");
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
    startedAt: "2026-05-29T10:00:00+05:30",
    endedAt: "2026-05-29T10:00:00+05:30",
    durationSeconds,
    isIdle: false,
  };
}
