/**
 * Shared layout constants and row types for the arrangement timeline, split out so
 * the timeline shell and its row/lane parts agree on geometry (row height, header
 * column bounds, the leading gutter, snap/zoom options) without a circular import.
 */
import type { GroupMeta, TrackMeta } from "../../audio/project/types";

export const ROW = "h-11.5 shrink-0";
export const ROW_PX = 46; // must match ROW (h-11.5)
export const DEFAULT_HEADER_W = 220; // px - the left header column (drag-resizable)
export const HEADER_MIN = 150;
export const HEADER_MAX = 460;

/**
 * How much lane a pinned header column has to leave behind to be worth pinning.
 *
 * A pinned header is a good trade where the timeline is wide: you keep the track names in
 * view for the price of a fixed column. Where it is narrow it is a bad one - a 220px column
 * out of a 500px timeline is not a header beside an arrangement, it is a header with a
 * sliver next to it - and scrolling it away with the lanes gives the whole width back.
 */
export const MIN_PINNED_LANE_W = 560;

/**
 * Whether the header column should be pinned (`position: sticky`) rather than scrolling away
 * with the lanes. **A function of the room, not of the device** - it used to be `!isPhone`,
 * which was right about a phone and wrong about a tablet, where two docked panels leave the
 * arrangement narrower than a phone in landscape. The same lesson as the pads' `fitPads`:
 * tier by what is on screen, not by what the screen is.
 *
 * An unmeasured viewport (the first paint, before the ResizeObserver reports) counts as wide:
 * pinned is the calmer state to start from, and starting scrolled would show the headers
 * sliding into place on every mount.
 */
export const pinHeaders = (viewportW: number, headerW: number): boolean =>
  viewportW === 0 || viewportW - headerW >= MIN_PINNED_LANE_W;
export const RULER_H = 22; // px - must match Ruler's internal height
export const INDENT = 14; // px per tree depth
// A fixed leading gutter before the mute/solo controls, shared by group rows (holds
// the collapse arrow) and track rows (holds the audio record-enable, else empty), so
// mute/solo line up across both. GUTTER_PAD is the row's base left padding.
export const GUTTER = "w-4 shrink-0";
export const GUTTER_PAD = 8; // px
export const RESIZE_PX = 7; // grab zone on a block's right edge
export const DRAG_THRESH = 4; // px before an empty-lane press counts as a drag (no add)
export const TRAIL_BEATS = 16; // empty grid drawn past the content end (room to arrange into)

export const ZOOM = { min: 6, max: 96 };
export const SNAP_OPTIONS = [
  { label: "Bar", value: 4 },
  { label: "Beat", value: 1 },
  { label: "1/2", value: 0.5 },
];

export type Selection = { trackId: string; id: string } | null;

export type Row =
  | { kind: "group"; group: GroupMeta; depth: number }
  | { kind: "track"; track: TrackMeta; depth: number };
