/**
 * The kit's pads (sample ref + assigned MIDI note per pad), reactive to param changes
 * and cached so the snapshot is stable. Shared by the step grid and the drum piano-roll,
 * which both key their rows off which pads have a sample loaded and what note fires them.
 */
import { useRef, useSyncExternalStore } from "react";
import type { ParamStore } from "../audio/params/store";
import { DRUMKIT_PADS } from "../audio/instruments/catalog";

export interface DrumPad {
  /** 0-based pad index. */
  index: number;
  /** The pad's sample ref ("" / "none" when empty). */
  ref: string;
  /** The MIDI note that fires this pad. */
  note: number;
}

export function usePads(store: ParamStore): DrumPad[] {
  const cache = useRef<{ key: string; pads: DrumPad[] }>({ key: "", pads: [] });
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => {
      const pads = Array.from(
        { length: DRUMKIT_PADS },
        (_unused, index): DrumPad => ({
          index,
          ref: String(store.get(`pad${index + 1}.sample`)),
          note: Number(store.get(`pad${index + 1}.note`)),
        }),
      );
      const key = pads.map((pad) => `${pad.ref}:${pad.note}`).join("|");
      if (key !== cache.current.key) cache.current = { key, pads };
      return cache.current.pads;
    },
  );
}
