export type AppCategory =
  | "development"
  | "communication"
  | "learning"
  | "productivity"
  | "browser"
  | "entertainment"
  | "social"
  | "system"
  | "unknown";

export type AttentionEvent = {
  id: string;
  appName: string;
  windowTitle?: string;
  category: AppCategory;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  isIdle: boolean;
};

export type AttentionState = "focused" | "drifting" | "fragmented" | "recovering" | "idle";

export type DriftTransition = {
  fromApp: string;
  toApp: string;
  fromCategory: AppCategory;
  toCategory: AppCategory;
  kind: "focus" | "drift" | "recovery" | "neutral";
  count: number;
  averageDurationSeconds: number;
};
