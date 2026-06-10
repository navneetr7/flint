import type { AppCategory } from "@flint/domain";

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  development: "Development",
  communication: "Communication",
  learning: "Learning",
  productivity: "Productivity",
  browser: "Browsing",
  entertainment: "Entertainment",
  social: "Social Media",
  system: "System utilities",
  unknown: "Unclassified",
};

export const CATEGORY_COLORS: Record<AppCategory, string> = {
  development: "var(--color-focus-cyan)",
  communication: "var(--color-focus-blue)",
  learning: "var(--color-focus-green)",
  productivity: "var(--color-recovery-teal)",
  browser: "var(--color-focus-blue)",
  entertainment: "var(--color-drift-orange)",
  social: "var(--color-drift-magenta)",
  system: "rgba(154, 168, 199, 0.4)",
  unknown: "var(--color-text-soft)",
};

export const CATEGORY_OPTIONS: { value: AppCategory; label: string }[] = [
  { value: "development", label: "Development" },
  { value: "communication", label: "Communication" },
  { value: "learning", label: "Learning" },
  { value: "productivity", label: "Productivity" },
  { value: "browser", label: "Browser" },
  { value: "entertainment", label: "Entertainment" },
  { value: "social", label: "Social Media" },
  { value: "system", label: "System / Utility" },
  { value: "unknown", label: "Unknown" },
];

export function categoryLabel(category: AppCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function categoryColor(category: AppCategory): string {
  return CATEGORY_COLORS[category] ?? "rgba(255,255,255,0.1)";
}
