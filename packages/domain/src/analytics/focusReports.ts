import type { AttentionEvent } from "../attention/types";

export type ReportRange = "daily" | "weekly" | "monthly";

export type FocusReportBucket = {
  label: string;
  focusSeconds: number;
  driftSeconds: number;
  idleSeconds: number;
  activeSeconds: number;
};

export type FocusReport = {
  range: ReportRange;
  buckets: FocusReportBucket[];
  strongestBucket: FocusReportBucket | null;
  focusBalancePercent: number;
};

export function buildFocusReport(events: AttentionEvent[], range: ReportRange): FocusReport {
  const buckets = createBuckets(range);

  events.forEach((event) => {
    const bucket = buckets[bucketIndex(event, range)];
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

  const activeSeconds = buckets.reduce((total, bucket) => total + bucket.activeSeconds, 0);
  const focusSeconds = buckets.reduce((total, bucket) => total + bucket.focusSeconds, 0);

  return {
    range,
    buckets,
    strongestBucket: strongestFocusBucket(buckets),
    focusBalancePercent: activeSeconds === 0 ? 0 : Math.round((focusSeconds / activeSeconds) * 100),
  };
}

function createBuckets(range: ReportRange): FocusReportBucket[] {
  if (range === "daily") {
    return Array.from({ length: 24 }, (_, hour) => bucket(`${hour}`));
  }

  if (range === "weekly") {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(bucket);
  }

  return Array.from({ length: 31 }, (_, day) => bucket(`${day + 1}`));
}

function bucket(label: string): FocusReportBucket {
  return {
    label,
    focusSeconds: 0,
    driftSeconds: 0,
    idleSeconds: 0,
    activeSeconds: 0,
  };
}

function bucketIndex(event: AttentionEvent, range: ReportRange) {
  const date = new Date(event.startedAt);

  if (range === "daily") {
    return date.getHours();
  }

  if (range === "weekly") {
    return date.getDay();
  }

  return date.getDate() - 1;
}

function strongestFocusBucket(buckets: FocusReportBucket[]) {
  return buckets.reduce<FocusReportBucket | null>(
    (strongest, bucket) =>
      bucket.focusSeconds > (strongest?.focusSeconds ?? 0) ? bucket : strongest,
    null,
  );
}
