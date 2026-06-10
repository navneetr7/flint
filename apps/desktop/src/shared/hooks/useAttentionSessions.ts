import { useEffect, useMemo, useState } from "react";
import type { ReportRange } from "@flint/domain";
import { listAttentionSessionsForLocalRange, listTodayAttentionSessions } from "@/shared/api/attentionApi";
import { useAppStore } from "@/shared/store/appStore";
import { useAsyncData } from "./useAsyncData";

const REPORT_REFRESH_MS = 15 * 60 * 1000;

export function useAttentionSessions() {
  const attentionRevision = useAppStore((state) => state.attentionRevision);
  const dayKey = useLocalDayKey();

  return useAsyncData(() => listTodayAttentionSessions(), [attentionRevision, dayKey]);
}

export function useAttentionSessionsForRange(range: ReportRange) {
  const attentionRevision = useAppStore((state) => state.attentionRevision);
  const periodKey = useLocalPeriodKey(range);

  return useAsyncData(
    () => listAttentionSessionsForLocalRange(range),
    [attentionRevision, range, periodKey],
  );
}

/**
 * Like useAttentionSessionsForRange but only refetches every 15 minutes.
 * Suitable for Reports — shows all data for the period, just not live-updating.
 */
export function useAttentionSessionsThrottled(range: ReportRange) {
  const [refreshKey, setRefreshKey] = useState(0);
  const periodKey = useLocalPeriodKey(range);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRefreshKey((k) => k + 1);
    }, REPORT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  return useAsyncData(
    () => listAttentionSessionsForLocalRange(range),
    [refreshKey, range, periodKey],
  );
}

function useLocalDayKey() {
  return useLocalPeriodKey("daily");
}

function useLocalPeriodKey(range: ReportRange) {
  const [now, setNow] = useState(() => new Date());
  const periodKey = useMemo(() => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);

    if (range === "weekly") {
      date.setDate(date.getDate() - date.getDay());
    } else if (range === "monthly") {
      date.setDate(1);
    }

    return date.toISOString();
  }, [now, range]);

  useEffect(() => {
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 0, 0);

    const timeout = window.setTimeout(() => {
      setNow(new Date());
    }, Math.max(1_000, nextMidnight.getTime() - Date.now() + 1_000));

    return () => window.clearTimeout(timeout);
  }, [periodKey]);

  return periodKey;
}
