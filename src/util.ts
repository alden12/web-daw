/** Tiny pure helpers shared across the app (DOM-free, so audio modules can use them too). */

/** Constrain `value` to the inclusive range [lo, hi]. */
export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
