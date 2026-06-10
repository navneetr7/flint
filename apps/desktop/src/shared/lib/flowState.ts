import type { AttentionEvent } from "@flint/domain";
import { isFocusCategory, isDistractionCategory } from "@flint/domain";

export type FlowState = "focused" | "neutral" | "distracted" | "break";

export function flowState(event: AttentionEvent): FlowState {
  if (event.isIdle) return "break";
  if (isFocusCategory(event.category)) return "focused";
  if (isDistractionCategory(event.category)) return "distracted";
  return "neutral";
}
