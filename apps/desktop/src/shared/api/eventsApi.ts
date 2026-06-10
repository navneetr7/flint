import { mergeAdjacentSessions, type AttentionEvent, type ReportRange } from "@flint/domain";
import { callTauri, isTauriRuntime } from "./tauriClient";

export async function listAttentionEvents() {
  if (!isTauriRuntime()) return [];
  const events = await callTauri<AttentionEvent[]>("list_attention_events");
  return events.reverse();
}

export async function listAttentionSessions() {
  return mergeAdjacentSessions(await listAttentionEvents());
}

export async function listTodayAttentionSessions(now = new Date()) {
  const range = localDayRange(now);
  const events = await listAttentionEventsBetween(range.start, range.end);
  return mergeAdjacentSessions(clipEventsToRange(events, range.start, range.end));
}

export async function listAttentionSessionsForLocalRange(reportRange: ReportRange, now = new Date()) {
  const range = localReportRange(reportRange, now);
  const events = await listAttentionEventsBetween(range.start, range.end);
  return mergeAdjacentSessions(clipEventsToRange(events, range.start, range.end));
}

export async function listAttentionEventsBetween(start: Date, end: Date) {
  if (!isTauriRuntime()) return [];
  const events = await callTauri<AttentionEvent[]>("list_attention_events_between", {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  });
  return events;
}

export async function clearAttentionEvents() {
  if (!isTauriRuntime()) return;
  await callTauri<void>("clear_attention_events");
}

export async function clearDailySummary(localDate: string) {
  if (!isTauriRuntime()) return;
  await callTauri<void>("clear_daily_summary", { localDate });
}

export async function recordCurrentAttentionSample() {
  if (!isTauriRuntime()) return null;
  return callTauri<AttentionEvent | null>("record_current_attention_sample");
}


export function localDayRange(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function localReportRange(reportRange: ReportRange, now: Date) {
  if (reportRange === "daily") return localDayRange(now);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (reportRange === "weekly") {
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  start.setDate(1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clipEventsToRange(events: AttentionEvent[], start: Date, end: Date) {
  return events.flatMap((event) => {
    const startedAt = maxDate(new Date(event.startedAt), start);
    const endedAt = minDate(new Date(event.endedAt), end);
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (durationSeconds <= 0) return [];
    return [{ ...event, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSeconds }];
  });
}

function maxDate(left: Date, right: Date) {
  return left.getTime() >= right.getTime() ? left : right;
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}
