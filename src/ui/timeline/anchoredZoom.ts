/**
 * Zoom a scrolling surface about a fixed point, so whatever is under that point stays under
 * it (MOBILE-2).
 *
 * **Anchoring is the whole feature.** Zooming about the scroll origin instead slides the
 * content out from under the cursor or the fingers, which reads as the surface fighting you
 * rather than responding. The arrangement and the piano roll had the same six lines of this
 * written out twice, and pinch would have made it four; this is the one copy.
 *
 * The maths is "what is under the pointer, in content units, before and after": convert the
 * pointer to a unit position at the old scale, then put the scroll offset wherever it has to
 * be for that same unit to land back under the pointer at the new one.
 *
 * The correction is deferred a frame because the scale is React state - the element has not
 * been laid out at the new size yet when this is called, so setting `scrollLeft` now would
 * clamp against the old content width and lose the tail of a zoom-out.
 */

export interface AnchoredZoom {
  /** The scroller whose offset is corrected. */
  element: HTMLElement;
  /** Where the zoom is anchored, in client coordinates on the axis being zoomed. */
  clientPosition: number;
  /**
   * Pixels of scrollable content before the origin: the arrangement's header column where it
   * scrolls with the lanes, the roll's label gutter, the ruler's height on the vertical axis.
   * Zero where the thing is `position: sticky` and so consumes no scroll.
   */
  leadPx: number;
  /** Scale before and after, in pixels per content unit (a beat, or a pitch row). */
  from: number;
  to: number;
}

/** Horizontal: keeps the beat under `clientPosition` where it was. */
export function anchorZoomX({ element, clientPosition, leadPx, from, to }: AnchoredZoom): void {
  if (from <= 0 || to <= 0) return;
  const local = clientPosition - element.getBoundingClientRect().left;
  const unitAtAnchor = (local + element.scrollLeft - leadPx) / from;
  requestAnimationFrame(() => {
    element.scrollLeft = unitAtAnchor * to - local + leadPx;
  });
}

/** Vertical: keeps the pitch row under `clientPosition` where it was. */
export function anchorZoomY({ element, clientPosition, leadPx, from, to }: AnchoredZoom): void {
  if (from <= 0 || to <= 0) return;
  const local = clientPosition - element.getBoundingClientRect().top;
  const unitAtAnchor = (local + element.scrollTop - leadPx) / from;
  requestAnimationFrame(() => {
    element.scrollTop = unitAtAnchor * to - local + leadPx;
  });
}
