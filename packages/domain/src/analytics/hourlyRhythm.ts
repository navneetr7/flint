import type { AttentionEvent } from "../attention/types";

export type HourlyRhythmBucket = {
  hour: number;
  focusSeconds: number;
  driftSeconds: number;
  idleSeconds: number;
  activeSeconds: number;
};

export function buildHourlyRhythm(events: AttentionEvent[]): HourlyRhythmBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    focusSeconds: 0,
    driftSeconds: 0,
    idleSeconds: 0,
    activeSeconds: 0,
  }));

  events.forEach((event) => {
    const bucket = buckets[new Date(event.startedAt).getHours()];

    if (!bucket) {
      return;
    }

    if (event.isIdle) {
      bucket.idleSeconds += event.durationSeconds;
      return;
    }

    bucket.activeSeconds += event.durationSeconds;

    if (event.category === "development" || event.category === "learning" || event.category === "productivity") {
      bucket.focusSeconds += event.durationSeconds;
    }

    if (event.category === "entertainment" || event.category === "social") {
      bucket.driftSeconds += event.durationSeconds;
    }
  });

  return buckets;
}
