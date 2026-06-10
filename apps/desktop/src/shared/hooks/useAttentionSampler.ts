import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/shared/api/tauriClient";
import { useAppStore } from "@/shared/store/appStore";
import type { AttentionEvent } from "@flint/domain";

// The Rust background thread is the sole sampler — it records every 5 s and
// emits "attention-sampled" so the frontend stays in sync without running a
// parallel sampler that would cause double-recording and timer jumps.
export function useAttentionSampler() {
  const setLastAttentionSample = useAppStore((state) => state.setLastAttentionSample);
  const bumpAttentionRevision = useAppStore((state) => state.bumpAttentionRevision);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlistenSample: (() => void) | undefined;
    let unlistenReclassified: (() => void) | undefined;

    listen<AttentionEvent | null>("attention-sampled", (event) => {
      const sample = event.payload;
      setLastAttentionSample(sample ?? null);
      if (sample) {
        bumpAttentionRevision();
      }
    }).then((fn) => { unlistenSample = fn; });

    // AI background classification finishes asynchronously — refresh the trail
    // so reclassified events (updated category, icon, flow state) appear immediately.
    listen("events-reclassified", () => {
      bumpAttentionRevision();
    }).then((fn) => { unlistenReclassified = fn; });

    return () => {
      unlistenSample?.();
      unlistenReclassified?.();
    };
  }, [bumpAttentionRevision, setLastAttentionSample]);
}
