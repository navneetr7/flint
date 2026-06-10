import { buildAttentionAnalytics } from "./attentionAnalytics";
import type { AttentionEvent } from "../attention/types";

export type NarrativeChapter = {
  title: string;
  paragraphs: string[];
};

export type NarrativeReport = {
  title: string;
  weather: {
    label: string;
    description: string;
    tone: "focus" | "calm" | "drift" | "recovery";
  };
  chapters: NarrativeChapter[];
};

export function buildBehavioralNarrative(events: AttentionEvent[]): NarrativeReport {
  if (events.length === 0) {
    return {
      title: "Nothing yet today",
      weather: {
        label: "No data",
        description: "Start working and Flint will build your daily picture.",
        tone: "calm",
      },
      chapters: [
        {
          title: "Waiting for data",
          paragraphs: [
            "Flint hasn't recorded any sessions yet today. Once you start working, your focus, breaks, and app usage will appear here.",
          ],
        },
      ],
    };
  }

  const analytics = buildAttentionAnalytics(events);
  const score = analytics.focusScore;

  // Title based on score
  let title = "Mixed day";
  if (score >= 80) title = "Strong focus day";
  else if (score >= 60) title = "Solid progress";
  else if (score < 40) title = "Rough day";

  // Weather based on score
  let weather: { label: string; description: string; tone: "focus" | "calm" | "drift" | "recovery" } = {
    label: "Some drift",
    description: "You had some distractions but kept coming back to focus.",
    tone: "recovery",
  };

  if (score >= 80) {
    weather = {
      label: "In the zone",
      description: "Focused and consistent today — very little time lost to distractions.",
      tone: "focus",
    };
  } else if (score >= 40 && score < 60) {
    weather = {
      label: "Scattered",
      description: "Lots of switching between tasks today. Focus was hard to hold.",
      tone: "calm",
    };
  } else if (score < 40) {
    weather = {
      label: "Off track",
      description: "Distractions dominated today. A shorter, more focused block tomorrow would help.",
      tone: "drift",
    };
  }

  const chapters: NarrativeChapter[] = [];

  // Chapter 1: Overview
  const totalHours = (analytics.focusSeconds / 3600).toFixed(1);
  const deepWorkMins = Math.round(analytics.deepWorkSeconds / 60);
  const idleMins = Math.round(analytics.idleSeconds / 60);

  chapters.push({
    title: "How your day looked",
    paragraphs: [
      `You spent **${totalHours} hours** on focused work today${deepWorkMins > 0 ? `, including **${deepWorkMins} minutes** in deep uninterrupted blocks` : ""}.`,
      idleMins > 5
        ? `You were away from the screen for **${idleMins} minutes** — that's normal and healthy.`
        : "You stayed consistently at the screen today with very few breaks.",
    ],
  });

  // Chapter 2: Switches & Distractions
  const avgSessionMins = Math.round(analytics.averageFocusSessionSeconds / 60);
  const driftCount = analytics.driftCount;
  const mostDistractingApp = analytics.mostDistractingApp;
  const distractedSwitches = analytics.driftTransitionCount;
  const productiveSwitches = analytics.productiveSwitchCount;

  const switchesParagraph = distractedSwitches > 0
    ? `You switched apps **${analytics.appSwitches} times** today. Most of those — **${productiveSwitches}** — were normal work switches like editor to terminal. But **${distractedSwitches}** times you switched to something distracting. Average focus session: **${avgSessionMins} min**.`
    : `You switched apps **${analytics.appSwitches} times** today, all between work tools. No distracting switches recorded — good signal.`;

  const driftsParagraph = driftCount > 0
    ? `You drifted to distractions **${driftCount} times**${mostDistractingApp ? `, most often to **${mostDistractingApp}**` : ""}. Each drift costs time to recover from, even if it feels short.`
    : `You didn't drift to any distracting apps today. That's a clean session.`;

  chapters.push({
    title: "Focus vs. distraction",
    paragraphs: [switchesParagraph, driftsParagraph],
  });

  // Chapter 3: Peak time
  const peakHour = analytics.strongestFocusHour;
  const topApp = analytics.mostVisitedApp;

  const peakParagraphs: string[] = [];
  if (peakHour !== null) {
    peakParagraphs.push(
      `Your best focus window was around **${peakHour}:00**${topApp ? `, mostly in **${topApp}**` : ""}.`
    );
    peakParagraphs.push(
      "Try to protect that time slot tomorrow — turn off notifications and don't schedule calls in it."
    );
  } else {
    peakParagraphs.push("Your focus was spread fairly evenly across the day with no clear peak window.");
    peakParagraphs.push("Try blocking a 90-minute distraction-free window tomorrow to build a consistent peak.");
  }

  chapters.push({ title: "Your best window", paragraphs: peakParagraphs });

  return { title, weather, chapters };
}
