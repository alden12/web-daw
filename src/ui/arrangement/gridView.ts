/**
 * The arrangement's shared horizontal view: which beat sits at the left edge of the
 * time axis.
 *
 * Zoom already survives across mounts because it is persisted (`web-daw:arr-zoom`), but
 * scroll position lived in a DOM ref inside `ArrangementTimeline`. That was fine while
 * the timeline was always mounted; the touch shell (MOBILE-1) shows the full arrangement
 * and the selected track's lane strip in *different tabs*, so only one is mounted at a
 * time and a local ref means switching tabs silently loses your place.
 *
 * Stored in **beats, not pixels**, for two reasons: the two surfaces have different
 * amounts of chrome before beat 0 (the timeline scrolls a header column inside its
 * scroller; the strip's header sits outside it), so a shared pixel offset would point at
 * different bars in each; and beats survive a zoom change, where pixels would drift.
 *
 * The value may be **negative**, meaning the timeline is scrolled far enough left to show
 * its header column. Flooring it at 0 was a bug: it made "showing the headers" and
 * "showing bar 1" the same stored value, so returning to the tab always landed on bar 1
 * with the headers scrolled out of sight.
 *
 * Deliberately **session-only, not persisted** - where you are looking is transient view
 * state, and restoring a stale offset on load would be disorienting rather than helpful.
 * There is no subscribe seam either: only one arrangement surface is mounted at a time,
 * so nothing needs to react, and a version that notified ended up fighting the user's own
 * scrolling (see useSharedGridScroll).
 */

let scrollBeats = 0;

/** The beat at the left edge of the visible time axis; negative inside a header gutter. */
export function readGridScrollBeats(): number {
  return scrollBeats;
}

/** Record where the arrangement is scrolled to, to a thousandth of a beat. */
export function writeGridScrollBeats(next: number): void {
  scrollBeats = Math.round(next * 1000) / 1000;
}
