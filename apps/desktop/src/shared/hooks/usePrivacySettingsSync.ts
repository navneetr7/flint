import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { getPrivacySettings } from "@/shared/api/attentionApi";
import { isTauriRuntime } from "@/shared/api/tauriClient";
import { useAppStore } from "@/shared/store/appStore";

const privacySettingsChangedEvent = "privacy-settings-changed";

export function usePrivacySettingsSync() {
  const setTrackingStatus = useAppStore((state) => state.setTrackingStatus);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isActive = true;

    async function syncTrackingStatus() {
      const settings = await getPrivacySettings();
      if (!isActive) {
        return;
      }

      setTrackingStatus(settings.privateModeEnabled ? "paused" : "active");
    }

    void syncTrackingStatus();

    const unlisten = listen(privacySettingsChangedEvent, () => {
      void syncTrackingStatus();
    });

    return () => {
      isActive = false;
      void unlisten.then((dispose) => dispose());
    };
  }, [setTrackingStatus]);
}
