import type { AttentionEvent, DriftTransition } from "../attention/types";
import { isFocusCategory, isDistractionCategory } from "../analytics/attentionAnalytics";

export function buildDriftTransitions(events: AttentionEvent[]): DriftTransition[] {
  const transitions = new Map<string, DriftTransition & { totalDurationSeconds: number }>();

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];

    if (!previous || !current || previous.appName === current.appName) {
      continue;
    }

    const key = `${previous.appName}->${current.appName}`;
    const existing = transitions.get(key);

    if (existing) {
      existing.count += 1;
      existing.totalDurationSeconds += current.durationSeconds;
      existing.averageDurationSeconds = Math.round(existing.totalDurationSeconds / existing.count);
      continue;
    }

    transitions.set(key, {
      fromApp: previous.appName,
      toApp: current.appName,
      fromCategory: previous.category,
      toCategory: current.category,
      kind: transitionKind(previous, current),
      count: 1,
      averageDurationSeconds: current.durationSeconds,
      totalDurationSeconds: current.durationSeconds,
    });
  }

  return Array.from(transitions.values()).map(({ totalDurationSeconds, ...transition }) => transition);
}

function transitionKind(previous: AttentionEvent, current: AttentionEvent): DriftTransition["kind"] {
  const previousIsDrift = isDistractionCategory(previous.category);
  const currentIsDrift = isDistractionCategory(current.category);
  const currentIsFocus = isFocusCategory(current.category);

  if (!previousIsDrift && currentIsDrift) {
    return "drift";
  }

  if (previousIsDrift && currentIsFocus) {
    return "recovery";
  }

  if (isFocusCategory(previous.category) && currentIsFocus) {
    return "focus";
  }

  return "neutral";
}
