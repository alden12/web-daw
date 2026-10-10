/**
 * The key each built-in's portrait is stored under, shared by the generator and Explore (whose
 * items are keyed the same way), so the two cannot drift apart.
 */
export const PORTRAIT_KEYS = {
  instrument: (type: string) => `instrument:${type}`,
  patch: (id: string) => `patch:${id}`,
  effect: (type: string) => `effect:${type}`,
  midi: (type: string) => `midi:${type}`,
} as const;
