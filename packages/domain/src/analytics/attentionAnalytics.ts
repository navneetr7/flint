import type { AppCategory, AttentionEvent } from "../attention/types";
import { buildDriftTransitions } from "../drift/transitions";
import {
  calculateFocusScoreBreakdown,
  type FocusScoreBreakdown,
} from "../focus/focusScore";
import { findDeepWorkSessions, sessionDurationSeconds } from "../timeline/sessions";

const focusCategories: AppCategory[] = ["development", "learning", "productivity"];
const distractionCategories: AppCategory[] = ["entertainment", "social"];
const communicationCategories: AppCategory[] = ["communication"];
// 15 min continuous focus = deep work threshold (flow-state research baseline).
const deepWorkThresholdSeconds = 15 * 60;
const strongDeepWorkThresholdSeconds = 45 * 60;

export type AttentionAnalytics = {
  totalSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  focusSeconds: number;
  distractionSeconds: number;
  communicationSeconds: number;
  appSwitches: number;
  driftTransitionCount: number;
  productiveSwitchCount: number;
  switchesPerHour: number;
  driftTransitionsPerHour: number;
  focusScore: number;
  focusScoreBreakdown: FocusScoreBreakdown;
  deepWorkSeconds: number;
  deepWorkSessions: number;
  strongDeepWorkSessions: number;
  averageFocusSessionSeconds: number;
  averageActiveSessionSeconds: number;
  longestFocusSession: AttentionEvent | null;
  longestDeepWorkSession: AttentionEvent | null;
  longestRecoverySeconds: number | null;
  totalRecoverySeconds: number;
  averageRecoverySeconds: number | null;
  driftCount: number;
  driftSeconds: number;
  mostVisitedApp: string | null;
  mostDistractingApp: string | null;
  strongestFocusHour: number | null;
  fragmentationLevel: "low" | "medium" | "high";
};

export function buildAttentionAnalytics(events: AttentionEvent[]): AttentionAnalytics {
  const activeEvents = events.filter((event) => !event.isIdle);
  const transitions = buildDriftTransitions(activeEvents);
  const appSwitches = transitions.reduce((total, transition) => total + transition.count, 0);
  const driftTransitionCount = transitions
    .filter((t) => t.kind === "drift")
    .reduce((total, t) => total + t.count, 0);
  const productiveSwitchCount = transitions
    .filter((t) => t.kind === "focus")
    .reduce((total, t) => total + t.count, 0);
  const focusEvents = activeEvents.filter((event) => isFocusCategory(event.category));
  const distractionEvents = activeEvents.filter((event) => isDistractionCategory(event.category));
  const communicationEvents = activeEvents.filter((event) => isCommunicationCategory(event.category));

  // Deep work: session must contain at least one focus event and total session time
  // (focus + research/browser) ≥ 15 min. Research is cognitively part of the session.
  const deepWorkSessionGroups = findDeepWorkSessions(activeEvents).filter((group) => {
    const hasFocus = group.some((e) => isFocusCategory(e.category));
    return hasFocus && sessionDurationSeconds(group) >= deepWorkThresholdSeconds;
  });
  const deepWorkAllEvents = deepWorkSessionGroups.flat();

  const recoveryDurations = recoveryDurationsSeconds(activeEvents);
  const activeHours = sumSeconds(activeEvents) / 3600;
  const switchesPerHour = activeHours === 0 ? 0 : appSwitches / activeHours;
  const driftTransitionsPerHour = activeHours === 0 ? 0 : driftTransitionCount / activeHours;
  const focusScoreBreakdown = calculateFocusScoreBreakdown({
    events: activeEvents,
    appSwitches,
    driftTransitions: driftTransitionCount,
  });

  return {
    totalSeconds: sumSeconds(events),
    activeSeconds: sumSeconds(activeEvents),
    idleSeconds: sumSeconds(events.filter((event) => event.isIdle)),
    focusSeconds: sumSeconds(focusEvents),
    distractionSeconds: sumSeconds(distractionEvents),
    communicationSeconds: sumSeconds(communicationEvents),
    appSwitches,
    driftTransitionCount,
    productiveSwitchCount,
    switchesPerHour,
    driftTransitionsPerHour,
    focusScore: focusScoreBreakdown.score,
    focusScoreBreakdown,
    deepWorkSeconds: sumSeconds(deepWorkAllEvents),
    deepWorkSessions: deepWorkSessionGroups.length,
    strongDeepWorkSessions: deepWorkSessionGroups.filter(
      (group) => sessionDurationSeconds(group) >= strongDeepWorkThresholdSeconds,
    ).length,
    averageFocusSessionSeconds: averageSeconds(focusEvents),
    averageActiveSessionSeconds: averageSeconds(activeEvents),
    longestFocusSession: longestByDuration(focusEvents),
    longestDeepWorkSession: longestByDuration(deepWorkAllEvents),
    longestRecoverySeconds: recoveryDurations.length === 0 ? null : Math.max(...recoveryDurations),
    totalRecoverySeconds: recoveryDurations.reduce((total, seconds) => total + seconds, 0),
    averageRecoverySeconds: recoveryDurations.length === 0 ? null : averageNumbers(recoveryDurations),
    driftCount: countDrifts(activeEvents),
    driftSeconds: sumSeconds(distractionEvents),
    mostVisitedApp: mostFrequent(activeEvents.map((event) => event.appName)),
    mostDistractingApp: mostByDuration(distractionEvents),
    strongestFocusHour: strongestFocusHour(focusEvents),
    fragmentationLevel: fragmentationLevel(driftTransitionsPerHour),
  };
}

export function buildRealityCheckInsights(events: AttentionEvent[]) {
  if (events.length === 0) {
    return [];
  }

  const analytics = buildAttentionAnalytics(events);
  const insights = [
    `${analytics.appSwitches} app ${analytics.appSwitches === 1 ? "switch" : "switches"} recorded.`,
  ];

  if (analytics.deepWorkSessions > 0) {
    insights.push(
      `${analytics.deepWorkSessions} deep work ${analytics.deepWorkSessions === 1 ? "session" : "sessions"} detected.`,
    );
  }

  if (analytics.longestFocusSession) {
    insights.push(
      `Longest focus session: ${Math.round(
        analytics.longestFocusSession.durationSeconds / 60,
      )} minutes in ${analytics.longestFocusSession.appName}.`,
    );
  }

  if (analytics.fragmentationLevel === "high") {
    insights.push(`Distraction switching was high at ${Math.round(analytics.driftTransitionsPerHour)} drift switches per hour.`);
  }

  if (analytics.mostDistractingApp) {
    insights.push(`Most frequent drift source: ${analytics.mostDistractingApp}.`);
  }

  if (analytics.strongestFocusHour !== null) {
    insights.push(`Strongest focus hour started at ${analytics.strongestFocusHour}:00.`);
  }

  return insights;
}

export function isFocusCategory(category: AppCategory) {
  return focusCategories.includes(category);
}

export function isDistractionCategory(category: AppCategory) {
  return distractionCategories.includes(category);
}

function isCommunicationCategory(category: AppCategory) {
  return communicationCategories.includes(category);
}

function sumSeconds(events: AttentionEvent[]) {
  return events.reduce((total, event) => total + event.durationSeconds, 0);
}

function longestByDuration(events: AttentionEvent[]) {
  return events.reduce<AttentionEvent | null>(
    (longest, event) => (!longest || event.durationSeconds > longest.durationSeconds ? event : longest),
    null,
  );
}

function averageSeconds(events: AttentionEvent[]) {
  if (events.length === 0) {
    return 0;
  }

  return sumSeconds(events) / events.length;
}

function averageNumbers(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function countDrifts(events: AttentionEvent[]) {
  const active = events.filter((e) => !e.isIdle);
  return active.reduce((total, event, index) => {
    const previous = active[index - 1];
    if (!previous) return total;
    return !isDistractionCategory(previous.category) && isDistractionCategory(event.category)
      ? total + 1
      : total;
  }, 0);
}

// Returns seconds of focus needed to reach 5 min of sustained focus after each drift.
// Neutral events don't count toward the threshold and don't break the streak.
function recoveryDurationsSeconds(events: AttentionEvent[]): number[] {
  const SUSTAINED_SECONDS = 5 * 60;
  const recoveries: number[] = [];
  type State = "baseline" | "drifting" | "recovering";
  let state: State = "baseline";
  let focusAccum = 0;

  for (const event of events) {
    const isFocus = isFocusCategory(event.category);
    const isDrift = isDistractionCategory(event.category);

    if (state === "baseline") {
      if (isDrift) state = "drifting";
    } else if (state === "drifting") {
      if (isFocus) {
        // First focus event after drift — start measuring recovery
        state = "recovering";
        focusAccum = event.durationSeconds;
        if (focusAccum >= SUSTAINED_SECONDS) {
          // Immediately hit a long session — record minimum recovery time
          recoveries.push(SUSTAINED_SECONDS);
          state = "baseline";
          focusAccum = 0;
        }
      }
    } else if (state === "recovering") {
      if (isFocus) {
        focusAccum += event.durationSeconds;
        if (focusAccum >= SUSTAINED_SECONDS) {
          recoveries.push(focusAccum);
          state = "baseline";
          focusAccum = 0;
        }
      } else if (isDrift) {
        // Drifted again before sustained focus — discard partial recovery.
        state = "drifting";
        focusAccum = 0;
      }
    }
  }

  return recoveries;
}

function strongestFocusHour(events: AttentionEvent[]) {
  const secondsByHour = new Map<number, number>();

  events.forEach((event) => {
    const hour = new Date(event.startedAt).getHours();
    secondsByHour.set(hour, (secondsByHour.get(hour) ?? 0) + event.durationSeconds);
  });

  return Array.from(secondsByHour.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function mostByDuration(events: AttentionEvent[]): string | null {
  const totals = new Map<string, number>();

  for (const event of events) {
    totals.set(event.appName, (totals.get(event.appName) ?? 0) + event.durationSeconds);
  }

  if (totals.size === 0) return null;

  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const [topApp, topSeconds] = sorted[0];
  const secondSeconds = sorted[1]?.[1] ?? 0;

  // Suppress when multiple apps are tied — no meaningful "most distracting" signal.
  if (topSeconds === secondSeconds) return null;

  return topApp;
}

// Uses drift-only transitions (focus→distraction) so normal workflow switching
// (editor↔terminal↔browser docs) never inflates fragmentation.
function fragmentationLevel(driftTransitionsPerHour: number): AttentionAnalytics["fragmentationLevel"] {
  if (driftTransitionsPerHour >= 4) {
    return "high";
  }

  if (driftTransitionsPerHour >= 1.5) {
    return "medium";
  }

  return "low";
}
