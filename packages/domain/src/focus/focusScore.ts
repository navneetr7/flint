import type { AttentionEvent } from "../attention/types";
import { isFocusCategory, isDistractionCategory } from "../analytics/attentionAnalytics";
import { findDeepWorkSessions, sessionDurationSeconds } from "../timeline/sessions";

// Events from earlier in the day fade in influence; recent activity dominates.
const HALF_LIFE_HOURS = 2;

type FocusScoreInput = {
  events: AttentionEvent[];
  appSwitches: number;
  driftTransitions: number;
  /** Override reference time. Defaults to the latest event end time (or now if no events). */
  now?: Date;
};

export type FocusScoreBreakdown = {
  activeSeconds: number;
  focusedSeconds: number;
  driftSeconds: number;
  deepWorkSeconds: number;
  focusRatio: number;
  driftRatio: number;
  deepWorkRatio: number;
  switchesPerHour: number;
  focusContribution: number;
  /** Minimum score guaranteed when deep work sessions are present. Replaces additive bonus. */
  deepWorkFloor: number;
  driftPenalty: number;
  switchPenalty: number;
  baseOffset: number;
  /** False when < 10 min of active data — score is directional only. */
  minDataMet: boolean;
  score: number;
};

export function calculateFocusScore({ events, appSwitches, driftTransitions, now }: FocusScoreInput) {
  return calculateFocusScoreBreakdown({ events, appSwitches, driftTransitions, now }).score;
}

export function calculateFocusScoreBreakdown({
  events,
  appSwitches,
  driftTransitions,
  now,
}: FocusScoreInput): FocusScoreBreakdown {
  const activeEvents = events.filter((e) => !e.isIdle);

  // Raw seconds — used for display and minDataMet check (unaffected by decay).
  const activeSeconds = activeEvents.reduce((t, e) => t + e.durationSeconds, 0);
  const focusedSeconds = activeEvents.filter((e) => isFocusCategory(e.category)).reduce((t, e) => t + e.durationSeconds, 0);
  const driftSeconds = activeEvents.filter((e) => isDistractionCategory(e.category)).reduce((t, e) => t + e.durationSeconds, 0);

  const deepWorkSessionGroups = findDeepWorkSessions(activeEvents).filter(
    (group) => group.some((e) => isFocusCategory(e.category)) && sessionDurationSeconds(group) >= 15 * 60,
  );
  const deepWorkSeconds = deepWorkSessionGroups.flat().reduce((t, e) => t + e.durationSeconds, 0);

  const minDataMet = activeSeconds >= 10 * 60;

  if (activeSeconds === 0) {
    return {
      activeSeconds: 0,
      focusedSeconds: 0,
      driftSeconds: 0,
      deepWorkSeconds: 0,
      focusRatio: 0,
      driftRatio: 0,
      deepWorkRatio: 0,
      switchesPerHour: 0,
      focusContribution: 0,
      deepWorkFloor: 0,
      driftPenalty: 0,
      switchPenalty: 0,
      baseOffset: 0,
      minDataMet: false,
      score: 0,
    };
  }

  // Reference point for decay: latest event end, or caller-supplied now.
  const ref = resolveRef(activeEvents, now);

  // Weighted sums — recent activity gets more influence.
  const wActive = activeEvents.reduce((t, e) => t + e.durationSeconds * decayWeight(e, ref), 0);
  const wFocus = activeEvents.filter((e) => isFocusCategory(e.category)).reduce((t, e) => t + e.durationSeconds * decayWeight(e, ref), 0);
  const wDrift = activeEvents.filter((e) => isDistractionCategory(e.category)).reduce((t, e) => t + e.durationSeconds * decayWeight(e, ref), 0);
  const wDeep = deepWorkSessionGroups.flat().reduce((t, e) => t + e.durationSeconds * decayWeight(e, ref), 0);

  const focusRatio = wActive === 0 ? 0 : wFocus / wActive;
  const driftRatio = wActive === 0 ? 0 : wDrift / wActive;
  const deepWorkRatio = wActive === 0 ? 0 : wDeep / wActive;

  const activeHours = activeSeconds / 3600;
  const switchesPerHour = activeHours === 0 ? 0 : appSwitches / activeHours;
  const driftTransitionsPerHour = activeHours === 0 ? 0 : driftTransitions / activeHours;

  const focusContribution = focusRatio * 90;
  const driftPenalty = Math.min(driftRatio * 35, 35);
  const switchPenalty = Math.min(driftTransitionsPerHour * 5, 25);
  const baseOffset = 10;

  // Deep work floor: completing real deep work sessions earns a score minimum.
  // This replaces the old additive bonus that was silently clipped by the 100 ceiling.
  const deepWorkSessionCount = deepWorkSessionGroups.length;
  const deepWorkFloor = deepWorkSessionCount >= 2 ? 50 : deepWorkSessionCount >= 1 ? 35 : 0;

  const rawScore = Math.round(focusContribution - driftPenalty - switchPenalty + baseOffset);
  const score = Math.max(clampScore(rawScore), deepWorkFloor);

  return {
    activeSeconds,
    focusedSeconds,
    driftSeconds,
    deepWorkSeconds,
    focusRatio,
    driftRatio,
    deepWorkRatio,
    switchesPerHour,
    focusContribution,
    deepWorkFloor,
    driftPenalty,
    switchPenalty,
    baseOffset,
    minDataMet,
    score,
  };
}

function resolveRef(events: AttentionEvent[], now?: Date): Date {
  if (events.length === 0) return now ?? new Date();
  const lastEnd = Math.max(...events.map((e) => new Date(e.endedAt).getTime()));
  const base = new Date(lastEnd);
  return now && now.getTime() > lastEnd ? now : base;
}

function decayWeight(event: AttentionEvent, ref: Date): number {
  const ageHours = (ref.getTime() - new Date(event.endedAt).getTime()) / 3_600_000;
  return Math.pow(0.5, Math.max(0, ageHours) / HALF_LIFE_HOURS);
}

function clampScore(score: number) {
  return Math.min(Math.max(score, 0), 100);
}

