import type { PropsWithChildren } from "react";
import { useAttentionSampler } from "@/shared/hooks/useAttentionSampler";
import { usePrivacySettingsSync } from "@/shared/hooks/usePrivacySettingsSync";

export function AppProviders({ children }: PropsWithChildren) {
  useAttentionSampler();
  usePrivacySettingsSync();

  return children;
}
