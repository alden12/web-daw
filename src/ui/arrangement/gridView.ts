/**
 * The arrangement's shared horizontal view: which beat sits at the left edge of the
 * time axis.
 *
 * Zoom already survives across mounts because it is persisted (`web-daw:arr-zoom`); scroll
 * position lived in a DOM ref inside `ArrangementTimeline`, which loses your place whenever
 * that component unmounts. It was introduced for MOBILE-1, where the arrangement and the
 * selected track's lane strip were separate tabs and only one could be mounted at a time.
 *
 * **That is no longer why it exists.** MOBILE-5 deleted the lane strip - the sheet's Full
 * detent is what it was - so there is one arrangement surface and one caller. What remains
 * is remounting: swapping shells (a window resized past the desktop breakpoint) and
 * changing tier (a phone rotated into landscape lands in the tablet tier) both tear the
 * timeline down and build it again, and arriving back at bar 1 is a poor answer to having
 * turned the phone sideways.
 *
 * Stored in **beats, not pixels**, and both halves of that still hold. Beats survive a zoom
 * change, where pixels would drift. And the chrome before beat 0 is not a constant: the
 * header column scrolls inside the scroller on a phone but is `position: sticky` elsewhere
 * (`stickyHeaders`), so a pixel offset saved before a rotation points at a different bar
 * after it - which is exactly the remount this exists to survive.
 *
 * The value may be **negative**, meaning the timeline is scrolled far enough left to show
 * its header column. Flooring it at 0 was a bug: it made "showing the headers" and
 * "showing bar 1" the same stored value, so a remount always landed on bar 1 with the
 * headers scrolled out of sight.
 *
 * Deliberately **session-only, not persisted** - where you are looking is transient view
 * state, and restoring a stale offset on load would be disorienting rather than helpful.
 * There is no subscribe seam either: one surface reads it, so nothing needs to react, and a
 * version that notified ended up fighting the user's own scrolling (see useSharedGridScroll).
 *
 * **Null until something scrolls**, which is not the same as 0. Beat 0 is the *right* edge
 * of the header column, so opening there scrolls the lane headers - the track names, the
 * mute and solo buttons - off the left of the screen before you have touched anything.
 * That is only visible where the headers scroll rather than stick (phone portrait), and a
 * surface cannot express "show me the content's left edge" as a beat without knowing its
 * own lead, so the unset case is its own value rather than a number.
 */

let scrollBeats: number | null = null;

/**
 * The beat at the left edge of the visible time axis; negative inside a header gutter, and
 * null if no arrangement surface has been scrolled yet.
 */
export function readGridScrollBeats(): number | null {
  return scrollBeats;
}

/** Record where the arrangement is scrolled to, to a thousandth of a beat. */
export function writeGridScrollBeats(next: number): void {
  scrollBeats = Math.round(next * 1000) / 1000;
}
