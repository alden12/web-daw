/**
 * Pure playback-window math for an audio clip (no DOM, so it is unit-testable on
 * its own). An audio clip plays a slice of its buffer - the loop region - which
 * tiles across a placement. "Sliding the audio under the grid" (`gridOffsetSec`)
 * keeps the loop window fixed on the grid and moves the buffer underneath it, so a
 * different part of the recording sits under the window: the played buffer slice is
 * the window shifted back by the slide.
 *
 * The window is anchored to the placement onset (the slice plays *at* the onset,
 * not at the window's grid position - matching the pre-slide behaviour). If the
 * slide pushes the window's start before the buffer, the missing head is rendered
 * as silence by delaying the source start (`delaySec`) rather than playing earlier
 * samples. Returns null when the window lands entirely off the buffer (pure silence).
 *
 * `maxDurationSec` caps the total time from the onset (silence head + audio) so a
 * region that would overrun the arrangement loop boundary is truncated there instead
 * of ringing on and overlapping the loop's restart (the double-trigger bug). Omitted
 * = no cap; a cap that leaves no audible audio returns null.
 */
export interface PlayWindow {
  /** Buffer offset to begin playback at, in seconds (>= 0). */
  offset: number;
  /** Duration of buffer to play, in seconds (> 0). */
  span: number;
  /** Silence before the audio (the window head that falls before the buffer), in seconds. */
  delaySec: number;
}

export function audioPlayWindow(
  loopStartSec: number | undefined,
  loopEndSec: number | undefined,
  gridOffsetSec: number | undefined,
  bufferDuration: number,
  maxDurationSec?: number,
): PlayWindow | null {
  const slide = gridOffsetSec ?? 0;
  const winStart = loopStartSec ?? 0;
  const winEnd = loopEndSec ?? bufferDuration;
  // Buffer content under the (grid-fixed) window = the window shifted back by the slide.
  let offset = winStart - slide;
  const end = Math.min(winEnd - slide, bufferDuration);
  let delaySec = 0;
  if (offset < 0) {
    // The window starts before the buffer: render the head as silence.
    delaySec = -offset;
    offset = 0;
  }
  let span = end - offset;
  if (span <= 0) return null; // window is entirely off the buffer -> silence
  if (maxDurationSec !== undefined) {
    // Truncate at the loop boundary: the audible budget is the cap minus the
    // silent head; if that is gone, there is nothing left to play this onset.
    const budget = maxDurationSec - delaySec;
    if (budget <= 0) return null;
    span = Math.min(span, budget);
  }
  return { offset, span, delaySec };
}
