/**
 * Musical-time conversions, in one place. Tempo is beats per minute; the transport,
 * scheduler, recorder, and clip panels all convert between beats and seconds, so the
 * `/ 60` factor lives here rather than being re-derived inline. Pure and DOM-free.
 */

/** Beats per second at a given tempo (bpm / 60). */
export const beatsPerSecond = (bpm: number): number => bpm / 60;

/** Convert a duration in seconds to beats at the given tempo. */
export const secondsToBeats = (seconds: number, bpm: number): number => seconds * beatsPerSecond(bpm);

/** Convert a duration in beats to seconds at the given tempo. */
export const beatsToSeconds = (beats: number, bpm: number): number => beats / beatsPerSecond(bpm);
