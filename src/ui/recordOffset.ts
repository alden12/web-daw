/**
 * The manual recording-latency offset, persisted in localStorage. A take captured
 * from the mic lands late by the input+output round-trip; the recorder shifts it back
 * by an automatic estimate (output + base latency), but that estimate can't include
 * the interface's input latency (the browser doesn't expose it). This offset is the
 * user's manual trim on top of that estimate: how many milliseconds *earlier* to place
 * a take. Increase it if takes still sit late; the recorder reads it at capture time
 * (like readAutoQuantize), while the settings UI edits it via usePersistentNumber.
 */
export const RECORD_OFFSET_KEY = "web-daw:record-offset-ms";
export const RECORD_OFFSET_RANGE = { min: -200, max: 500 } as const;

/** Extra milliseconds to shift a recorded take earlier (0 = auto estimate only). */
export const readRecordOffsetMs = (): number => {
  try {
    const raw = localStorage.getItem(RECORD_OFFSET_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};
