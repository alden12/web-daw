/**
 * Where a menu popover goes: pure geometry, no DOM (see `Menu.tsx` for the component).
 *
 * **Every level places itself against the viewport, not against its parent.** A submenu
 * positioned inside its parent's box inherits that box's clipping and its scrolling, which
 * is how a third level came to render inside a scrollable second one and be invisible.
 * Each level is portaled and fixed, and each asks this module the same question.
 *
 * The answer has three parts, and all three are needed - dropping any one of them is a bug
 * that only shows up at one viewport size:
 *
 * - **Flip** to the other side when the preferred side has no room (a menu near the bottom
 *   opens upwards; a flyout near the right edge opens to the left).
 * - **Shift** along the other axis so it stays inside the margins.
 * - **Size**: report how much room there is, so a popover taller than the space scrolls
 *   inside itself instead of running off the edge. This is the part a menu near the middle
 *   of a phone needs and a desktop never does.
 *
 * Pure and exported so the placement can be tested at sizes that are awkward to reproduce
 * in a browser (a twelve-row list on a 390x390 viewport) without a rendering environment.
 */

/** Keep a popover this far inside the viewport edges. */
export const VIEWPORT_MARGIN = 8;
/** The gap between a popover and the thing it hangs off. */
export const ANCHOR_GAP = 4;
/**
 * A popover never shrinks below this, even where the room says it should. Below a couple of
 * rows it is not a menu you can use, and scrolling a 20px box is worse than overlapping the
 * anchor by a little.
 */
export const MIN_POPOVER_HEIGHT = 96;

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  /** `below` hangs off the bottom of the anchor (a trigger); `beside` sits next to it (a row). */
  strategy: "below" | "beside";
  /**
   * Which way it prefers to go. For `below` this is the edge it aligns to; for `beside` it
   * is the side it opens on. Either way it is a preference, and room wins over it.
   */
  side: "left" | "right";
}

export interface Placed {
  top: number;
  left: number;
  /** Cap for `max-height`: past this the popover scrolls inside itself. */
  maxHeight: number;
  /** Cap for `max-width`, so a long label cannot push a popover off the side. */
  maxWidth: number;
  /** The side it actually went, which is not always the side it asked for. */
  side: "left" | "right";
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Where to put a popover of `size`, hanging off `anchor`, inside `viewport`. */
export function placeMenu(anchor: Box, size: Size, viewport: Size, placement: Placement): Placed {
  const maxWidth = viewport.width - VIEWPORT_MARGIN * 2;
  const width = Math.min(size.width, maxWidth);

  if (placement.strategy === "below") {
    const below = viewport.height - (anchor.top + anchor.height) - ANCHOR_GAP - VIEWPORT_MARGIN;
    const above = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
    // Flip only when it does not fit *and* there is more room the other way: near the middle
    // of a short viewport neither side fits, and dropping downwards is the calmer of the two.
    const flipUp = size.height > below && above > below;
    const maxHeight = Math.max(MIN_POPOVER_HEIGHT, flipUp ? above : below);
    const height = Math.min(size.height, maxHeight);
    // Clamped on both branches, so "inside the viewport" is unconditional. In the ordinary
    // case the clamp is a no-op; where it bites - a viewport too short for the popover on
    // either side of the anchor - it slides over the trigger rather than off the screen.
    const top = clamp(
      flipUp ? anchor.top - ANCHOR_GAP - height : anchor.top + anchor.height + ANCHOR_GAP,
      VIEWPORT_MARGIN,
      viewport.height - VIEWPORT_MARGIN - height,
    );
    const alignedLeft = placement.side === "right" ? anchor.left + anchor.width - width : anchor.left;
    return {
      top,
      left: clamp(alignedLeft, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - width),
      maxHeight,
      maxWidth,
      side: placement.side,
    };
  }

  const room = {
    right: viewport.width - (anchor.left + anchor.width) - ANCHOR_GAP - VIEWPORT_MARGIN,
    left: anchor.left - ANCHOR_GAP - VIEWPORT_MARGIN,
  };
  const preferred = placement.side;
  const other = preferred === "right" ? "left" : "right";
  // In preference order: the way the parent went, then the other way, then - where neither
  // fits - the roomier of the two, which is then clamped into the margin below.
  const side =
    room[preferred] >= width ? preferred : room[other] >= width ? other : room.right >= room.left ? "right" : "left";

  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, viewport.height - VIEWPORT_MARGIN * 2);
  const height = Math.min(size.height, maxHeight);
  const desiredLeft = side === "right" ? anchor.left + anchor.width + ANCHOR_GAP : anchor.left - ANCHOR_GAP - width;
  return {
    // Level with the row it belongs to, slid up only as far as it must be to fit.
    top: clamp(anchor.top, VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - height),
    left: clamp(desiredLeft, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - width),
    maxHeight,
    maxWidth,
    side,
  };
}
