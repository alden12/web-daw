/**
 * Keep something that floats over a scroller inside the part of it you can actually see
 * (MOBILE-7).
 *
 * The selected note's kebab hangs off the note's right edge, and a note can be wider than the
 * viewport or scrolled halfway out of it. Left alone, the kebab goes with it: an affordance you
 * have to scroll to find is one you stop reaching for, which on a phone means the actions are
 * effectively gone.
 *
 * `leadPx` is the scrollable content in front of the grid that is *covered* rather than
 * scrolled away - the roll's sticky label column. It is subtracted from the room on the right
 * because it occupies the left of the viewport at every scroll position, so the visible slice
 * of the grid starts at `scrollLeft` and is that much shorter than the scroller is wide.
 */
export function clampIntoView({
  wanted,
  width,
  scrollOffset,
  viewportSize,
  leadPx,
}: {
  /** Where the thing would go if nothing were in the way, in content pixels. */
  wanted: number;
  /** How wide it is, so its far edge lands inside the viewport rather than its near one. */
  width: number;
  /** `scrollLeft`, or `scrollTop` on the other axis - none of this cares which. */
  scrollOffset: number;
  viewportSize: number;
  leadPx: number;
}): number {
  const first = scrollOffset;
  const last = scrollOffset + viewportSize - leadPx - width;
  // `first` wins a viewport too narrow to hold the thing at all, so it stays reachable at the
  // near edge rather than being pushed off the far one.
  return Math.max(first, Math.min(wanted, last));
}
