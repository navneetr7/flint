import type { AttentionEvent } from "../attention/types";
import { isFocusCategory, isDistractionCategory } from "./attentionAnalytics";

export type DriftEpisode = {
  startedAt: string;
  /** Last focus app active before the drift began. Null if no focus preceded it. */
  triggerApp: string | null;
  /** Total non-drift seconds since the last drift (or session start). */
  focusSecondsBeforeDrift: number;
  /** The app that dominated the drift episode. */
  primaryDriftApp: string;
  /** All distinct apps visited during the episode. */
  allDriftApps: string[];
  /** Total seconds spent in distraction during this episode. */
  durationSeconds: number;
  /** True if the user returned to a focus app after this episode. */
  recovered: boolean;
};

function primaryApp(apps: string[]): string {
  const counts = new Map<string, number>();
  apps.forEach((a) => counts.set(a, (counts.get(a) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? apps[0] ?? "";
}

export function buildDriftEpisodes(events: AttentionEvent[]): DriftEpisode[] {
  const active = events.filter((e) => !e.isIdle);
  const episodes: DriftEpisode[] = [];

  let lastFocusApp: string | null = null;
  let secondsBeforeDrift = 0;
  let inDrift = false;
  let driftStartedAt = "";
  let driftApps: string[] = [];
  let driftSeconds = 0;

  function closeEpisode(recovered: boolean) {
    episodes.push({
      startedAt: driftStartedAt,
      triggerApp: lastFocusApp,
      focusSecondsBeforeDrift: secondsBeforeDrift,
      primaryDriftApp: primaryApp(driftApps),
      allDriftApps: [...new Set(driftApps)],
      durationSeconds: driftSeconds,
      recovered,
    });
    inDrift = false;
    driftApps = [];
    driftSeconds = 0;
    secondsBeforeDrift = 0;
  }

  for (const event of active) {
    if (isDistractionCategory(event.category)) {
      if (!inDrift) {
        inDrift = true;
        driftStartedAt = event.startedAt;
      }
      driftApps.push(event.appName);
      driftSeconds += event.durationSeconds;
    } else {
      if (inDrift) {
        closeEpisode(isFocusCategory(event.category));
      }
      secondsBeforeDrift += event.durationSeconds;
      if (isFocusCategory(event.category)) {
        lastFocusApp = event.appName;
      }
    }
  }

  if (inDrift) {
    closeEpisode(false);
  }

  return episodes;
}
