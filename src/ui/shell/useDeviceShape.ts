/**
 * Which shell to render, and what shape it has to work with (MOBILE-1). The four-region
 * desktop grid assumes a wide screen *and* a precise pointer, so the tier is read from
 * both rather than width alone: a coarse pointer is what makes 3px resize handles and
 * hover-only affordances unusable, and no amount of width fixes that.
 *
 * Three tiers, matching the roadmap's "tier by device, don't build one mobile":
 * - `phone`   play / tweak / agent-driven creation - one panel at a time, thumb navigation.
 * - `tablet`  a genuine editing surface - the same touch shell with room for more at once.
 * - `desktop` the video-editor grid (ActivityRail + library | center | agent, timeline).
 *
 * A narrow *desktop* window also gets the touch shell. That is deliberate: it keeps the
 * mobile layout previewable and e2e-testable without a real device, and a 700px-wide
 * window can't host the grid anyway.
 *
 * `short` is a separate axis from the tier, because a phone in landscape is *wide* (it
 * lands in the tablet tier at ~844px) while being the shortest viewport the app ever
 * sees. Panels that stack vertically have to go side by side there instead.
 */
import { useSyncExternalStore } from "react";

export type DeviceTier = "phone" | "tablet" | "desktop";

export interface DeviceShape {
  tier: DeviceTier;
  /** Too short to stack the editor above the device rack and have both be usable. */
  short: boolean;
}

/** Above this, a fine-pointer device is a desktop; at or below it the grid has no room. */
const NARROW_MAX = 899;
/** At or below this, one panel at a time is all that fits. */
const PHONE_MAX = 767;
/** At or below this, vertical space is the scarce axis (a phone in landscape is ~390-430). */
const SHORT_MAX = 520;

const COARSE_POINTER = "(pointer: coarse)";

function readDeviceShape(): DeviceShape {
  if (typeof window === "undefined") return { tier: "desktop", short: false };
  const coarse = window.matchMedia(COARSE_POINTER).matches;
  const { innerWidth: width, innerHeight: height } = window;
  const short = height <= SHORT_MAX;
  if (!coarse && width > NARROW_MAX) return { tier: "desktop", short };
  return { tier: width <= PHONE_MAX ? "phone" : "tablet", short };
}

/**
 * Re-read on anything that can change the answer: a resize, an orientation change, or
 * the pointer query itself flipping (a tablet gaining a trackpad, or devtools device
 * emulation being toggled).
 */
function subscribeDeviceShape(onChange: () => void): () => void {
  const pointerQuery = window.matchMedia(COARSE_POINTER);
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  pointerQuery.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
    pointerQuery.removeEventListener("change", onChange);
  };
}

// `useSyncExternalStore` compares snapshots by identity, so a fresh object every read
// would loop forever. Cache one and only swap it when a field actually changes.
let cached: DeviceShape = { tier: "desktop", short: false };
function getDeviceShapeSnapshot(): DeviceShape {
  const next = readDeviceShape();
  if (next.tier !== cached.tier || next.short !== cached.short) cached = next;
  return cached;
}

const SERVER_SHAPE: DeviceShape = { tier: "desktop", short: false };

export function useDeviceShape(): DeviceShape {
  return useSyncExternalStore(subscribeDeviceShape, getDeviceShapeSnapshot, () => SERVER_SHAPE);
}
