/**
 * The piano-roll quantize settings, persisted in localStorage. The roll's controls
 * read/write them reactively (via usePersistent), and the recorder's auto-quantize
 * getter reads them at capture time through `readAutoQuantize` - so both agree on the
 * same keys. The grid is shared with the roll's snap dropdown (one "grid" concept).
 */
import { type QuantizeSettings } from "../audio/sequencer/quantize";

export const QUANT_KEYS = {
  grid: "web-daw:roll-snap-div",
  strength: "web-daw:quantize-strength",
  ends: "web-daw:quantize-ends",
  onRecord: "web-daw:quantize-on-record",
} as const;

const readNumber = (key: string, fallback: number): number => {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const readBoolean = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};

/** The quantize settings to apply to a recording, or null when auto-quantize is off. */
export const readAutoQuantize = (): QuantizeSettings | null => {
  if (!readBoolean(QUANT_KEYS.onRecord)) return null;
  return {
    gridBeats: readNumber(QUANT_KEYS.grid, 0.25),
    strength: readNumber(QUANT_KEYS.strength, 1),
    ends: readBoolean(QUANT_KEYS.ends),
  };
};
