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
