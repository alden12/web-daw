/**
 * The editing surfaces' own preferences - snap, grid, quantize, the velocity lane - as hooks over
 * their persisted keys, so a surface and the settings page that shows the same preference are
 * reading one value rather than two copies that happen to share a key (MOBILE-19.4).
 *
 * The settings panel's Arrangement and Piano roll pages carry them on both shells. On desktop each
 * surface's toolbar menu keeps them too, beside their use; on touch the pages are the only home,
 * since a phone has no room for a menu of settings beside every surface.
 */
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";
import { QUANT_KEYS } from "./quantizeSettings";
import { FINEST_DIVISION } from "../audio/sequencer/quantize";

/** How hard Quantize pulls notes to the grid, as the offered steps. */
export const STRENGTH_OPTIONS = [0.25, 0.5, 0.75, 1];

export const useArrangementSnapOn = () => usePersistentBoolean("corrente:arr-snap-on", true);
/** In beats: a bar, a beat or a half (`SNAP_OPTIONS`). */
export const useArrangementSnapDivision = () => usePersistentNumber("corrente:arr-snap-div", 1, 0.5, 4);

export const useRollSnapOn = () => usePersistentBoolean("corrente:roll-snap-on", true);
/** In beats, from `GRID_DIVISIONS`. Shared with Quantize: one grid, not two. */
export const useRollGrid = () => usePersistentNumber(QUANT_KEYS.grid, 0.25, FINEST_DIVISION, 1);
export const useQuantizeStrength = () => usePersistentNumber(QUANT_KEYS.strength, 1, 0, 1);
export const useQuantizeEnds = () => usePersistentBoolean(QUANT_KEYS.ends, false);
export const useQuantizeOnRecord = () => usePersistentBoolean(QUANT_KEYS.onRecord, false);

/**
 * **Closed by default on touch**, where the roll is sharing a sheet with the pads and 56px is a
 * whole row of them. Velocity is not lost by hiding it: it renders as note fill strength, and
 * editing it per note belongs in the note's own menu on touch (MOBILE-7).
 *
 * Remembered per tier (MOBILE-18). `compact` only decides the *initial* value, so one shared key
 * meant opening the lane on a desktop pinned it open on the phone too, where it is exactly the
 * thing that does not fit. The two screens want different answers, so they get their own.
 */
export const useVelocityLane = (compact: boolean) =>
  usePersistentBoolean(compact ? "corrente:roll-vel-open:compact" : "corrente:roll-vel-open", !compact);
