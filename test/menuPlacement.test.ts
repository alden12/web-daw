import { describe, expect, it } from "vitest";
import {
  ANCHOR_GAP,
  MIN_POPOVER_HEIGHT,
  VIEWPORT_MARGIN,
  placeMenu,
  type Box,
  type Placed,
  type Size,
} from "../src/ui/menuPlacement";

const PHONE: Size = { width: 390, height: 844 };
const LANDSCAPE: Size = { width: 844, height: 390 };
const DESKTOP: Size = { width: 1440, height: 900 };

const anchor = (box: Partial<Box>): Box => ({ top: 0, left: 0, width: 32, height: 32, ...box });
/** A twelve-row list: the keys, the tempos - the case every one of these bugs showed up on. */
const LONG_LIST: Size = { width: 176, height: 340 };
const SHORT_LIST: Size = { width: 176, height: 90 };

/**
 * The invariant, whatever was asked for: the popover - at the size the caps leave it - is
 * inside the viewport's margins on all four sides.
 */
const expectInside = (placed: Placed, size: Size, viewport: Size) => {
  expect(placed.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  expect(placed.left + Math.min(size.width, placed.maxWidth)).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN);
  expect(placed.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  expect(placed.top + Math.min(size.height, placed.maxHeight)).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
};

describe("placeMenu, below a trigger", () => {
  const below = (anchorBox: Box, size: Size, viewport: Size, side: "left" | "right" = "right") =>
    placeMenu(anchorBox, size, viewport, { strategy: "below", side });

  it("hangs under the trigger when there is room", () => {
    const trigger = anchor({ top: 100, left: 200 });
    expect(below(trigger, SHORT_LIST, DESKTOP).top).toBe(100 + 32 + ANCHOR_GAP);
  });

  it("flips above a trigger near the bottom", () => {
    const trigger = anchor({ top: 800, left: 200 });
    const placed = below(trigger, LONG_LIST, PHONE);
    expect(placed.top + LONG_LIST.height).toBeLessThanOrEqual(800);
    expectInside(placed, LONG_LIST, PHONE);
  });

  it("aligns to the trigger's right edge for a right-aligned menu, and its left for a left one", () => {
    const trigger = anchor({ top: 100, left: 600, width: 40 });
    expect(below(trigger, SHORT_LIST, DESKTOP, "right").left).toBe(640 - SHORT_LIST.width);
    expect(below(trigger, SHORT_LIST, DESKTOP, "left").left).toBe(600);
  });

  it("pulls a menu back inside rather than aligning it off the edge", () => {
    // The shell's ⋮ sits at the right edge of a phone; aligning to it honestly would put the
    // popover's left edge fine and its right edge past the viewport on a wider menu.
    const trigger = anchor({ top: 60, left: PHONE.width - 40, width: 36 });
    const wide: Size = { width: 300, height: 120 };
    const placed = below(trigger, wide, PHONE, "left");
    expect(placed.left + wide.width).toBeLessThanOrEqual(PHONE.width - VIEWPORT_MARGIN);
    expect(placed.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it("reports the room it has, so a list too long for it scrolls instead of overflowing", () => {
    // Mid-way down a landscape phone: 196px of room below, for a 340px list.
    const trigger = anchor({ top: 150, left: 100 });
    const placed = below(trigger, LONG_LIST, LANDSCAPE);
    expect(placed.maxHeight).toBeLessThan(LONG_LIST.height);
    expectInside(placed, LONG_LIST, LANDSCAPE);
  });

  it("never caps a popover below a usable height", () => {
    // Mid-viewport on a short screen neither side fits; a 20px scrolling box is worse than
    // overlapping the anchor a little.
    const trigger = anchor({ top: 180, left: 100 });
    expect(below(trigger, LONG_LIST, LANDSCAPE).maxHeight).toBeGreaterThanOrEqual(MIN_POPOVER_HEIGHT);
  });

  it("stays on screen for a trigger anywhere in a phone-sized viewport", () => {
    for (let top = 0; top <= PHONE.height - 32; top += 11) {
      for (let left = 0; left <= PHONE.width - 32; left += 13) {
        const trigger = anchor({ top, left });
        (["left", "right"] as const).forEach((side) => {
          expectInside(below(trigger, LONG_LIST, PHONE, side), LONG_LIST, PHONE);
        });
      }
    }
  });

  it("caps the width too, so a long label cannot push it off the side", () => {
    const placed = below(anchor({ top: 40, left: 20 }), { width: 900, height: 100 }, PHONE);
    expect(placed.maxWidth).toBe(PHONE.width - VIEWPORT_MARGIN * 2);
    expect(placed.left).toBe(VIEWPORT_MARGIN);
  });
});

describe("placeMenu, beside a row", () => {
  const beside = (anchorBox: Box, size: Size, viewport: Size, side: "left" | "right") =>
    placeMenu(anchorBox, size, viewport, { strategy: "beside", side });

  it("opens level with its own row when it fits", () => {
    const row = anchor({ top: 300, left: 200, width: 180, height: 26 });
    expect(beside(row, SHORT_LIST, DESKTOP, "right").top).toBe(300);
    expect(beside(row, SHORT_LIST, DESKTOP, "right").left).toBe(380 + ANCHOR_GAP);
  });

  it("slides up rather than running off the bottom", () => {
    // A twelve-row list opened from a row near the bottom of a phone - most of it was under
    // the fold, which is what made the key and tempo menus unusable.
    const row = anchor({ top: 700, left: 100, width: 180, height: 26 });
    const placed = beside(row, LONG_LIST, PHONE, "right");
    expect(placed.top + LONG_LIST.height).toBeLessThanOrEqual(PHONE.height - VIEWPORT_MARGIN);
    expectInside(placed, LONG_LIST, PHONE);
  });

  it("flips to the other side when its own has run out", () => {
    const row = anchor({ top: 100, left: PHONE.width - 190, width: 180, height: 26 });
    expect(beside(row, SHORT_LIST, PHONE, "right").side).toBe("left");
    const atLeftEdge = anchor({ top: 100, left: 10, width: 180, height: 26 });
    expect(beside(atLeftEdge, SHORT_LIST, PHONE, "left").side).toBe("right");
  });

  it("keeps the parent's direction where both sides fit, so a chain does not zigzag", () => {
    const row = anchor({ top: 100, left: 600, width: 180, height: 26 });
    expect(beside(row, SHORT_LIST, DESKTOP, "left").side).toBe("left");
    expect(beside(row, SHORT_LIST, DESKTOP, "right").side).toBe("right");
  });

  it("takes the roomier side and clamps when neither fits", () => {
    // A third level on a phone: the parent flyout already spans most of the width.
    const row = anchor({ top: 100, left: 120, width: 180, height: 26 });
    const placed = beside(row, { width: 300, height: 200 }, PHONE, "right");
    expect(placed.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(placed.left + 300).toBeLessThanOrEqual(PHONE.width - VIEWPORT_MARGIN);
  });

  it("stays on screen for a row anywhere in a phone-sized viewport", () => {
    // The property the three separate positioning bugs all violated, checked exhaustively
    // rather than at the one spot each of them happened to be found at.
    for (let top = 0; top <= PHONE.height - 26; top += 13) {
      for (let left = 0; left <= PHONE.width - 180; left += 17) {
        const row = anchor({ top, left, width: 180, height: 26 });
        (["left", "right"] as const).forEach((side) => {
          expectInside(beside(row, LONG_LIST, PHONE, side), LONG_LIST, PHONE);
        });
      }
    }
  });
});
