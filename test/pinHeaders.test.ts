import { describe, expect, it } from "vitest";
import { DEFAULT_HEADER_W, HEADER_MAX, MIN_PINNED_LANE_W, pinHeaders } from "../src/ui/arrangement/shared";

/**
 * Whether the arrangement's header column is pinned or scrolls with the lanes. Pure, so the
 * shapes that matter are checked against the widths they actually have rather than by
 * resizing a browser - see `header-pinning.e2e.ts` for the two that need one.
 *
 * The widths are the timeline's own (the scroller's `clientWidth`), which is the workspace
 * less whatever is docked beside it - not the viewport.
 */
const TIMELINE = {
  desktop: 1160, // 1400 viewport, less the rail + library + agent columns
  tabletDocked: 736, // 1024 tablet with the library docked (it starts docked there)
  tabletBothDocked: 400, // ...and the agent too
  tabletBare: 1024,
  phoneLandscape: 844,
  phonePortrait: 390,
};

describe("pinHeaders", () => {
  it("pins where the lane keeps its width", () => {
    expect(pinHeaders(TIMELINE.desktop, DEFAULT_HEADER_W)).toBe(true);
    expect(pinHeaders(TIMELINE.tabletBare, DEFAULT_HEADER_W)).toBe(true);
    // A phone in landscape is wide, whatever tier it lands in - and it used to be pinned by
    // the old `!isPhone` test too, so this is the case that must not change.
    expect(pinHeaders(TIMELINE.phoneLandscape, DEFAULT_HEADER_W)).toBe(true);
  });

  it("lets them scroll where the header would take the arrangement", () => {
    // The reported bug: a tablet is not a small desktop once something is docked beside it.
    expect(pinHeaders(TIMELINE.tabletDocked, DEFAULT_HEADER_W)).toBe(false);
    expect(pinHeaders(TIMELINE.tabletBothDocked, DEFAULT_HEADER_W)).toBe(false);
    expect(pinHeaders(TIMELINE.phonePortrait, DEFAULT_HEADER_W)).toBe(false);
  });

  it("follows the header column's own width, not just the viewport's", () => {
    // Dragging the column wider is a way to lose the lane, so it is a way to unpin.
    expect(pinHeaders(900, DEFAULT_HEADER_W)).toBe(true);
    expect(pinHeaders(900, HEADER_MAX)).toBe(false);
  });

  it("treats an unmeasured viewport as wide, so nothing slides into place on mount", () => {
    expect(pinHeaders(0, DEFAULT_HEADER_W)).toBe(true);
  });

  it("switches exactly at the threshold", () => {
    expect(pinHeaders(MIN_PINNED_LANE_W + DEFAULT_HEADER_W, DEFAULT_HEADER_W)).toBe(true);
    expect(pinHeaders(MIN_PINNED_LANE_W + DEFAULT_HEADER_W - 1, DEFAULT_HEADER_W)).toBe(false);
  });
});
