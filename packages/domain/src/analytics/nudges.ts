import type { AttentionEvent } from "../attention/types";
import { buildAttentionAnalytics, isFocusCategory, isDistractionCategory } from "./attentionAnalytics";

export type SmartNudgeTone = "calm" | "focus" | "drift" | "recovery";

export type SmartNudge = {
  id: string;
  tone: SmartNudgeTone;
  title: string;
  detail: string;
};

export function buildSmartNudges(events: AttentionEvent[]): SmartNudge[] {
  if (events.length === 0) {
    return [
      {
        id: "waiting-for-data",
        tone: "calm",
        title: "Waiting for signal",
        detail: "Flint will surface patterns after a few local sessions.",
      },
    ];
  }

  const analytics = buildAttentionAnalytics(events);
  const latest = events.at(-1);
  const nudges: SmartNudge[] = [];

  if (latest && isDistractionCategory(latest.category) && latest.durationSeconds >= 5 * 60) {
    nudges.push({
      id: "active-drift",
      tone: "drift",
      title: "Attention drifting",
      detail: `${latest.appName} has held attention for ${minutes(latest.durationSeconds)} minutes.`,
    });
  }

  if (latest && isFocusCategory(latest.category) && latest.durationSeconds >= 25 * 60) {
    nudges.push({
      id: "focus-streak",
      tone: "focus",
      title: "Deep work forming",
      detail: `${minutes(latest.durationSeconds)} minutes uninterrupted in ${latest.appName}.`,
    });
  }

  if (analytics.fragmentationLevel === "high") {
    nudges.push({
      id: "heavy-switching",
      tone: "drift",
      title: "Frequent distraction drift",
      detail: `${Math.round(analytics.driftTransitionsPerHour)} distraction switches per hour — protect the next focus window.`,
    });
  }


  if (nudges.length === 0) {
    nudges.push({
      id: "stable",
      tone: "calm",
      title: "Attention stable",
      detail: `${analytics.appSwitches} switches recorded with no strong drift signal.`,
    });
  }

  return nudges.slice(0, 3);
}

function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}
