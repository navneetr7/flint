import type { AttentionEvent } from "../attention/types";
import { isFocusCategory, isDistractionCategory } from "../analytics/attentionAnalytics";

// Research/browser gaps ≤10 min are folded into sessions; entertainment/social ends them immediately.
const RESEARCH_TOLERANCE_SECONDS = 10 * 60;
// Glances under 10 s are treated as neutral rather than genuine distractions.
const DISTRACTION_MINIMUM_SECONDS = 10;

export function findDeepWorkSessions(events: AttentionEvent[]): AttentionEvent[][] {
  const sessions: AttentionEvent[][] = [];
  let current: AttentionEvent[] = [];
  let pending: AttentionEvent[] = [];
  let pendingDuration = 0;

  for (const event of events) {
    if (isFocusCategory(event.category)) {
      current.push(...pending, event);
      pending = [];
      pendingDuration = 0;
    } else if (isDistractionCategory(event.category)) {
      if (event.durationSeconds < DISTRACTION_MINIMUM_SECONDS && current.length > 0) {
        pending.push(event);
        pendingDuration += event.durationSeconds;
      } else {
        if (current.length > 0) sessions.push(current);
        current = [];
        pending = [];
        pendingDuration = 0;
      }
    } else {
      if (current.length > 0 && event.durationSeconds <= RESEARCH_TOLERANCE_SECONDS) {
        pending.push(event);
        pendingDuration += event.durationSeconds;
      } else {
        if (current.length > 0) sessions.push(current);
        current = [];
        pending = [];
        pendingDuration = 0;
      }
    }
  }

  if (current.length > 0) sessions.push(current);
  return sessions;
}

export function sessionDurationSeconds(session: AttentionEvent[]): number {
  return session.reduce((sum, e) => sum + e.durationSeconds, 0);
}

export function mergeAdjacentSessions(events: AttentionEvent[]) {
  return events.reduce<AttentionEvent[]>((sessions, event) => {
    const previous = sessions.at(-1);

    if (
      !previous ||
      previous.appName !== event.appName ||
      previous.isIdle !== event.isIdle ||
      previous.windowTitle !== event.windowTitle
    ) {
      sessions.push({ ...event });
      return sessions;
    }

    previous.endedAt = event.endedAt;
    previous.durationSeconds += event.durationSeconds;
    return sessions;
  }, []);
}
