import type { AttentionEvent } from "@flint/domain";
import { create } from "zustand";

type TrackingStatus = "active" | "paused";

type AppStore = {
  trackingStatus: TrackingStatus;
  lastAttentionSample: AttentionEvent | null;
  attentionRevision: number;
  setTrackingStatus: (status: TrackingStatus) => void;
  setLastAttentionSample: (event: AttentionEvent | null) => void;
  bumpAttentionRevision: () => void;
};

export const useAppStore = create<AppStore>((set) => ({
  trackingStatus: "active",
  lastAttentionSample: null,
  attentionRevision: 0,
  setTrackingStatus: (trackingStatus) => set({ trackingStatus }),
  setLastAttentionSample: (lastAttentionSample) => set({ lastAttentionSample }),
  bumpAttentionRevision: () =>
    set((state) => ({ attentionRevision: state.attentionRevision + 1 })),
}));
