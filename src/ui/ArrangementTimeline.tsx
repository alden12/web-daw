/**
 * The arrangement timeline (bottom): the project's bus tree on the left, one
 * lane per track on a shared bar grid on the right, with a ruler + playhead that
 * track the scheduler. The left column is a collapsible group tree (groups are
 * track-of-tracks buses); each group header carries collapse / mute / volume /
 * remove, and its tracks and subgroups nest beneath it.
 *
 * The lanes are an editable, zoomable, scrollable arrangement of clip placements:
 * - click an empty lane    -> place the track's active clip there.
 * - click a block          -> select it (selects its track + makes its clip
 *                             active, so the piano roll edits that clip).
 * - drag a block body       -> move it; drag its right edge -> resize the window.
 * - double-click a block    -> split it in two at the cursor.
 * - Delete removes the selected placement; Escape deselects.
 * - the ruler owns the project loop region (drag its two handles); wheel with a
 *   modifier zooms the time axis (cursor-anchored), plain wheel scrolls.
 *
 * Every drag commits through ONE coalescing command (move/resize), so a gesture
 * is one undo step and one feed entry. Geometry is shared with the piano roll via
 * `timeGrid`/`Ruler`, so the two views stay pixel-for-pixel consistent.
 */
import { useEffect, useRef, useState } from "react";
import type { ProjectStore, Track } from "../audio/project/projectStore";
import type { ClipStore } from "../audio/sequencer/clipStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { GroupMeta, Placement, TrackMeta } from "../audio/project/types";
import type { Dispatch } from "../audio/commands/types";
import { GRID } from "../audio/sequencer/types";
import { newClipId, newGroupId, newPlacementId } from "../audio/commands/ids";
import { useProject } from "../audio/project/useProject";
import { useClip } from "../audio/sequencer/useClip";
import { TransportBar } from "./TransportBar";
import { InlineRename } from "./InlineRename";
import { Fader, MuteSolo } from "./MixerControls";
import { CLIP_DND_TYPE, clipDndKindType, getDraggedClip } from "./clipDnd";
import { Ruler } from "./timeline/Ruler";
import {
  beatToX,
  floorBeat,
  snapBeat,
  xToBeat,
  DEFAULT_BEATS_PER_BAR,
} from "./timeline/timeGrid";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";

const ROW = "h-11.5 shrink-0";
const ROW_PX = 46; // must match ROW (h-11.5)
const DEFAULT_HEADER_W = 220; // px - the left header column (drag-resizable)
const HEADER_MIN = 150;
const HEADER_MAX = 460;
const RULER_H = 22; // px - must match Ruler's internal height
const INDENT = 14; // px per tree depth
const RESIZE_PX = 7; // grab zone on a block's right edge
const DRAG_THRESH = 4; // px before an empty-lane press counts as a drag (no add)
const TRAIL_BEATS = 16; // empty grid drawn past the content end (room to arrange into)

const ZOOM = { min: 6, max: 96 };
const SNAP_OPTIONS = [
  { label: "Bar", value: 4 },
  { label: "Beat", value: 1 },
  { label: "1/2", value: 0.5 },
];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

type Selection = { trackId: string; id: string } | null;

type Row =
  | { kind: "group"; group: GroupMeta; depth: number }
  | { kind: "track"; track: TrackMeta; depth: number };

/** Depth-first, collapse-aware flatten: subgroups then tracks under each group. */
function flattenRows(groups: GroupMeta[], tracks: TrackMeta[]): Row[] {
  const rows: Row[] = [];
  const walk = (group: GroupMeta, depth: number) => {
    rows.push({ kind: "group", group, depth });
    if (group.collapsed) return;
    for (const sub of groups.filter((g) => g.parentId === group.id))
      walk(sub, depth + 1);
    for (const t of tracks.filter((t) => t.parentId === group.id))
      rows.push({ kind: "track", track: t, depth: depth + 1 });
  };
  for (const g of groups.filter((g) => g.parentId === null)) walk(g, 0);
  // Defensive: surface any orphaned tracks (model keeps every track in a group).
  for (const t of tracks.filter(
    (t) => !groups.some((g) => g.id === t.parentId),
  ))
    rows.push({ kind: "track", track: t, depth: 0 });
  return rows;
}

/** A placement block: pixel-positioned region with a label, shared by both kinds. */
function Block({
  name,
  left,
  width,
  selected,
  onPointerDown,
  onDoubleClick,
  children,
}: {
  name?: string;
  left: number;
  width: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="placement"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`absolute top-1.5 bottom-1.5 rounded border overflow-hidden cursor-grab ${
        selected
          ? "border-you bg-you/25 ring-1 ring-you"
          : "border-line border-t-2 border-t-you bg-card hover:bg-card/70"
      }`}
      style={{ left, width: Math.max(3, width) }}
      title={name}
    >
      <div className="absolute inset-0 bg-you/10" />
      {children}
      <span className="absolute left-1.5 top-1 font-mono text-[9px] text-muted truncate max-w-full pr-1">
        {name}
      </span>
      {/* right-edge resize affordance */}
      <div className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize" />
    </div>
  );
}

/**
 * Mini note summary of an instrument clip, tiled across the placement window so a
 * looped clip (a window longer than the clip) shows its repeats, with a faint
 * divider at each loop boundary. Mirrors the scheduler's `tileClipNotes` math.
 */
function NoteMinis({
  store,
  placement,
  pxPerBeat,
}: {
  store: ClipStore;
  placement: Placement;
  pxPerBeat: number;
}) {
  const clip = useClip(store);
  const clipLen = clip.lengthBeats;
  if (clipLen <= 0) return null;
  const body = clip.notes.filter((n) => n.start >= 0 && n.start < clipLen);
  const pitches = body.map((n) => n.pitch);
  const lo = pitches.length ? Math.min(...pitches) : 48;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const span = Math.max(1, hi - lo);

  // Tiled note onsets (arrangement-relative beats), and loop-boundary dividers.
  const tiles: { key: string; tau: number; note: (typeof body)[number] }[] = [];
  for (const note of body) {
    let phase = (note.start - placement.offset) % clipLen;
    if (phase < 0) phase += clipLen;
    for (let tau = phase; tau < placement.length; tau += clipLen)
      tiles.push({ key: `${note.id}:${tau}`, tau, note });
  }
  const dividers: number[] = [];
  let first = -placement.offset % clipLen;
  if (first < 0) first += clipLen;
  for (let tau = first; tau < placement.length; tau += clipLen)
    if (tau > 0.001) dividers.push(tau);

  return (
    <>
      {dividers.map((tau) => (
        <div
          key={`d${tau}`}
          className="absolute top-0 bottom-0 w-px bg-you/25 pointer-events-none"
          style={{ left: beatToX(tau, pxPerBeat) }}
        />
      ))}
      {tiles.map(({ key, tau, note }) => (
        <div
          key={key}
          className="absolute h-0.5 rounded-[1px] bg-you/85 pointer-events-none"
          style={{
            left: beatToX(tau, pxPerBeat),
            width: Math.max(2, beatToX(note.length, pxPerBeat)),
            bottom: `${((note.pitch - lo) / span) * 60 + 18}%`,
          }}
        />
      ))}
    </>
  );
}

/**
 * One track's lane: an editable strip of placement blocks over the beat grid.
 * Owns the pointer gestures (place / select / move / resize / split) and reports
 * edits through the dispatch; selection is lifted to the parent so the roll and
 * the lanes agree on what's active.
 */
function Lane({
  track,
  width,
  pxPerBeat,
  beatsPerBar,
  snapOn,
  snapDiv,
  selection,
  markerBeat,
  dropBeat,
  onSelect,
  onMark,
  onHover,
  dispatch,
}: {
  track: Track;
  width: number;
  pxPerBeat: number;
  beatsPerBar: number;
  snapOn: boolean;
  snapDiv: number;
  selection: Selection;
  markerBeat: number | null;
  dropBeat: number | null;
  onSelect: (trackId: string, p: Placement) => void;
  onMark: (trackId: string, beat: number) => void;
  onHover: (beat: number | null) => void;
  dispatch: Dispatch;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ left: number; width: number } | null>(
    null,
  );
  const beatAt = (clientX: number) =>
    xToBeat(
      clientX - (ref.current?.getBoundingClientRect().left ?? 0),
      pxPerBeat,
    );
  const snapB = (b: number) => (snapOn ? snapBeat(b, snapDiv) : b);
  const floorB = (b: number) => floorBeat(b, snapOn ? snapDiv : GRID);

  // Drop a clip dragged from a clip rail at the cursor. Any same-kind track's lane
  // accepts: dropping on the clip's own track places the existing clip; dropping on
  // another same-kind track copies the clip into that track's pool first, then
  // places it.
  const accepts = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(clipDndKindType(track.kind));
  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    onHover(Math.max(0, floorB(beatAt(e.clientX))));
  };
  const onDrop = (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    onHover(null);
    const startBeat = Math.max(0, floorB(beatAt(e.clientX)));
    const draggedId = e.dataTransfer.getData(CLIP_DND_TYPE);
    if (draggedId && track.clips.some((c) => c.id === draggedId)) {
      // Same track: place the existing clip.
      const id = newPlacementId();
      dispatch({
        type: "addPlacement",
        trackId: track.id,
        id,
        clipId: draggedId,
        startBeat,
      });
      onSelect(track.id, {
        id,
        clipId: draggedId,
        startBeat,
        offset: 0,
        length: 0,
      });
      return;
    }
    // Cross-track: copy the dragged clip's content into this track, then place it.
    const content = getDraggedClip();
    if (!content || content.kind !== track.kind) return;
    const clipId = newClipId();
    const id = newPlacementId();
    dispatch({ type: "pasteClip", trackId: track.id, id: clipId, content });
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId,
      startBeat,
    });
    onSelect(track.id, { id, clipId, startBeat, offset: 0, length: 0 });
  };

  // Drag a block: body -> move, right edge -> resize. Both snap and coalesce.
  const onBlockDown = (p: Placement, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(track.id, p);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isEdge = rect.right - e.clientX <= RESIZE_PX;
    const downBeat = beatAt(e.clientX);
    const origin = { startBeat: p.startBeat, length: p.length };

    const onMove = (ev: PointerEvent) => {
      const delta = beatAt(ev.clientX) - downBeat;
      if (isEdge) {
        const length = Math.max(
          snapOn ? snapDiv : GRID,
          snapB(origin.length + delta),
        );
        if (length !== p.length)
          dispatch({
            type: "resizePlacement",
            trackId: track.id,
            placementId: p.id,
            length,
          });
      } else {
        const startBeat = Math.max(0, snapB(origin.startBeat + delta));
        if (startBeat !== p.startBeat)
          dispatch({
            type: "movePlacement",
            trackId: track.id,
            placementId: p.id,
            startBeat,
          });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Double-click a block to split it at the cursor.
  const onBlockDouble = (p: Placement, e: React.MouseEvent) => {
    e.stopPropagation();
    const at = snapB(beatAt(e.clientX));
    if (at > p.startBeat && at < p.startBeat + p.length)
      dispatch({
        type: "splitPlacement",
        trackId: track.id,
        placementId: p.id,
        atBeat: at,
        newId: newPlacementId(),
      });
  };

  // Create a new empty clip sized to [start, start+length) and place it; the new
  // clip becomes active so the roll follows it. (Place an existing clip via the
  // clip rail, or copy/paste / drag-loop to repeat one.)
  const createClip = (start: number, length: number) => {
    if (track.kind !== "instrument") return;
    const clipId = newClipId();
    const id = newPlacementId();
    dispatch({
      type: "addClip",
      trackId: track.id,
      id: clipId,
      empty: true,
      lengthBeats: length,
    });
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId,
      startBeat: start,
      length,
    });
    onSelect(track.id, { id, clipId, startBeat: start, offset: 0, length });
  };

  // Press on empty lane: a clean click drops a paste marker at that beat; a drag
  // sketches a new empty clip sized to the drag.
  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const downBeat = beatAt(e.clientX);
    const downX = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - downX) <= DRAG_THRESH) return;
      moved = true;
      const start = Math.max(0, floorB(Math.min(downBeat, beatAt(ev.clientX))));
      const end = snapB(Math.max(downBeat, beatAt(ev.clientX)));
      const length = Math.max(snapOn ? snapDiv : GRID, end - start);
      setDraft({
        left: beatToX(start, pxPerBeat),
        width: beatToX(length, pxPerBeat),
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraft(null);
      if (!moved) {
        // Click: drop a paste marker (copy/paste lands here).
        onMark(track.id, Math.max(0, floorB(downBeat)));
        return;
      }
      // Drag: an empty clip sized to the drag.
      const start = Math.max(0, floorB(Math.min(downBeat, beatAt(ev.clientX))));
      const length = Math.max(
        snapOn ? snapDiv : GRID,
        snapB(Math.max(downBeat, beatAt(ev.clientX))) - start,
      );
      createClip(start, length);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const laneBg = [
    `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${pxPerBeat * beatsPerBar}px)`,
    `repeating-linear-gradient(90deg, var(--color-line-soft) 0 1px, transparent 1px ${pxPerBeat}px)`,
  ].join(", ");

  return (
    <div
      ref={ref}
      data-testid="lane"
      onPointerDown={onLaneDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`${ROW} relative border-b border-line-soft cursor-copy`}
      style={{ width, background: laneBg }}
    >
      {track.placements.map((p) => {
        const clip = track.clips.find((c) => c.id === p.clipId);
        const selected =
          selection?.trackId === track.id && selection.id === p.id;
        return (
          <Block
            key={p.id}
            name={clip?.name}
            left={beatToX(p.startBeat, pxPerBeat)}
            width={beatToX(p.length, pxPerBeat)}
            selected={selected}
            onPointerDown={(e) => onBlockDown(p, e)}
            onDoubleClick={(e) => onBlockDouble(p, e)}
          >
            {clip && "store" in clip && (
              <NoteMinis
                store={clip.store}
                placement={p}
                pxPerBeat={pxPerBeat}
              />
            )}
          </Block>
        );
      })}
      {draft && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded border border-dashed border-you bg-you/15 pointer-events-none"
          style={{ left: draft.left, width: Math.max(2, draft.width) }}
        />
      )}
      {dropBeat !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-you pointer-events-none"
          style={{ left: beatToX(dropBeat, pxPerBeat) }}
        />
      )}
      {markerBeat !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-bright pointer-events-none"
          style={{ left: beatToX(markerBeat, pxPerBeat) }}
          title="Paste marker"
        >
          <span className="absolute -top-0.5 -left-1 w-2 h-2 rotate-45 bg-bright" />
        </div>
      )}
      {track.launchedClipId && (
        <div className="absolute inset-0 bg-ground/60 pointer-events-none flex items-center px-2 z-10">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-you bg-ground/80 border border-you/50 rounded px-1.5 py-0.5">
            ▶{" "}
            {track.clips.find((c) => c.id === track.launchedClipId)?.name ??
              "clip"}
          </span>
        </div>
      )}
    </div>
  );
}

function GroupHeader({
  group,
  depth,
  projectStore,
  dispatch,
}: {
  group: GroupMeta;
  depth: number;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  return (
    <div
      className={`${ROW} flex items-center gap-2 pr-2.5 border-b border-r border-line bg-center`}
      style={{ paddingLeft: 8 + depth * INDENT }}
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        title={group.collapsed ? "Expand group" : "Collapse group"}
        onClick={() =>
          projectStore.setGroupCollapsed(group.id, !group.collapsed)
        }
        className="w-3.5 text-2xl -m-0.75 text-muted cursor-pointer shrink-0"
      >
        {group.collapsed ? "▸" : "▾"}
      </button>
      <MuteSolo
        muted={group.muted}
        solo={group.solo}
        onMute={() =>
          dispatch({ type: "setGroup", groupId: group.id, muted: !group.muted })
        }
        onSolo={() =>
          dispatch({ type: "setGroup", groupId: group.id, solo: !group.solo })
        }
      />
      <InlineRename
        value={group.name}
        onCommit={(name) =>
          dispatch({ type: "setGroup", groupId: group.id, name })
        }
        className="font-mono text-[11px] tracking-wide uppercase text-bright flex-1 min-w-0"
      />
      <Fader
        value={group.volume}
        title="Group volume"
        width={48}
        onChange={(v) =>
          dispatch({ type: "setGroup", groupId: group.id, volume: v })
        }
      />
      <button
        type="button"
        title="Remove group and its contents"
        onClick={() => dispatch({ type: "removeGroup", groupId: group.id })}
        className="font-mono w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer shrink-0"
      >
        ×
      </button>
    </div>
  );
}

function TrackHeader({
  track,
  depth,
  selected,
  projectStore,
  dispatch,
}: {
  track: TrackMeta;
  depth: number;
  selected: boolean;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  return (
    <div
      onClick={() => projectStore.selectTrack(track.id)}
      className={`${ROW} flex items-center gap-2 pr-2.5 border-b border-r border-line-soft cursor-pointer ${
        selected
          ? "bg-you/10 shadow-[inset_3px_0_0_var(--color-you)]"
          : "bg-panel"
      }`}
      style={{ paddingLeft: 10 + depth * INDENT }}
    >
      <MuteSolo
        muted={track.muted}
        solo={track.solo}
        onMute={() =>
          dispatch({ type: "setTrack", trackId: track.id, muted: !track.muted })
        }
        onSolo={() =>
          dispatch({ type: "setTrack", trackId: track.id, solo: !track.solo })
        }
      />
      <InlineRename
        value={track.name}
        onCommit={(name) =>
          dispatch({ type: "setTrack", trackId: track.id, name })
        }
        className="font-mono text-[13px] text-bright flex-1 min-w-0"
      />
      <Fader
        value={track.volume}
        title="Volume"
        width={56}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onChange={(v) =>
          dispatch({ type: "setTrack", trackId: track.id, volume: v })
        }
      />
      <button
        type="button"
        title="Remove track"
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: "removeTrack", trackId: track.id });
        }}
        className="font-mono w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer shrink-0"
      >
        ×
      </button>
    </div>
  );
}

export function ArrangementTimeline({
  projectStore,
  scheduler,
  dispatch,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
}) {
  const project = useProject(projectStore);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const [pxPerBeat, setPxPerBeat] = usePersistentNumber(
    "web-daw:arr-zoom",
    24,
    ZOOM.min,
    ZOOM.max,
  );
  const [headerW, setHeaderW] = usePersistentNumber(
    "web-daw:arr-header-w",
    DEFAULT_HEADER_W,
    HEADER_MIN,
    HEADER_MAX,
  );
  const [snapOn, setSnapOn] = usePersistentBoolean("web-daw:arr-snap-on", true);
  const [snapDiv, setSnapDiv] = usePersistentNumber(
    "web-daw:arr-snap-div",
    1,
    0.5,
    4,
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [marker, setMarker] = useState<{
    trackId: string;
    beat: number;
  } | null>(null);
  // The single in-flight clip-drag drop target, so only the lane under the cursor
  // shows the drop indicator (not every lane the drag has passed through).
  const [dropTarget, setDropTarget] = useState<{
    trackId: string;
    beat: number;
  } | null>(null);
  const [viewportW, setViewportW] = useState(0);
  const clipboard = useRef<{
    clipId: string;
    offset: number;
    length: number;
  } | null>(null);

  const beatsPerBar = DEFAULT_BEATS_PER_BAR;
  const lengthBeats = project.lengthBeats;
  const rows = flattenRows(project.groups, project.tracks);
  const clipMode = project.tracks.some((t) => t.launchedClipId);

  // The grid runs past the loop and the furthest placement (room to arrange into),
  // and never stops short of the visible panel, so the bar grid fills it at any zoom.
  const arrangedEnd = Math.max(
    lengthBeats,
    ...project.tracks.flatMap((t) =>
      t.placements.map((p) => p.startBeat + p.length),
    ),
    0,
  );
  const minViewBeats =
    pxPerBeat > 0 ? Math.max(0, viewportW - headerW) / pxPerBeat : 0;
  const viewBeats = Math.max(
    arrangedEnd + TRAIL_BEATS,
    Math.ceil(minViewBeats),
  );
  const laneWidth = beatToX(viewBeats, pxPerBeat);
  const contentH = RULER_H + rows.length * ROW_PX;

  // Selecting a placement makes its track + clip active, so the roll follows it
  // (and clears any paste marker - selection and marker are mutually exclusive).
  const selectPlacement = (trackId: string, p: Placement) => {
    setSelection({ trackId, id: p.id });
    setMarker(null);
    projectStore.selectTrack(trackId);
    projectStore.selectClip(trackId, p.clipId);
  };

  // Clicking an empty lane drops a paste marker (track + beat) and clears the
  // selection - paste then lands at the marker.
  const placeMarker = (trackId: string, beat: number) => {
    setSelection(null);
    setMarker({ trackId, beat });
    projectStore.selectTrack(trackId);
  };

  // Delete removes the selected placement; Escape deselects (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
          el.closest("[data-clip-rail]"))
      )
        return;
      if (e.key === "Escape") {
        setSelection(null);
        setMarker(null);
        return;
      }
      if (!selection) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({
          type: "removePlacement",
          trackId: selection.trackId,
          placementId: selection.id,
        });
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, dispatch]);

  // Copy / cut / paste the selected placement. Capture phase + stopImmediate so
  // the piano roll's own C/X/V handler doesn't also fire (a placement, not a
  // note, is selected here). Paste lands after the selection, so it chains.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
          el.closest("[data-clip-rail]"))
      )
        return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;

      if (key === "c" || key === "x") {
        if (!selection) return;
        const t = projectStore.getTrack(selection.trackId);
        const p = t?.placements.find((x) => x.id === selection.id);
        if (!p) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        clipboard.current = {
          clipId: p.clipId,
          offset: p.offset,
          length: p.length,
        };
        if (key === "x") {
          dispatch({
            type: "removePlacement",
            trackId: selection.trackId,
            placementId: selection.id,
          });
          setSelection(null);
        }
        return;
      }

      // paste: needs a clipboard and a target track that owns the clip. Prefer the
      // marker (track + beat); else after the selection; else the track's end.
      const cb = clipboard.current;
      const targetId =
        marker?.trackId ??
        selection?.trackId ??
        projectStore.selectedId ??
        undefined;
      const t = targetId ? projectStore.getTrack(targetId) : undefined;
      if (!cb || !t || !t.clips.some((c) => c.id === cb.clipId)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const anchor = selection
        ? t.placements.find((x) => x.id === selection.id)
        : null;
      const trackEnd = t.placements.reduce(
        (m, p) => Math.max(m, p.startBeat + p.length),
        0,
      );
      const startBeat = marker
        ? marker.beat
        : anchor
          ? anchor.startBeat + anchor.length
          : trackEnd;
      const id = newPlacementId();
      dispatch({
        type: "addPlacement",
        trackId: t.id,
        id,
        clipId: cb.clipId,
        startBeat,
        offset: cb.offset,
        length: cb.length,
      });
      setMarker(null);
      setSelection({ trackId: t.id, id });
      projectStore.selectTrack(t.id);
      projectStore.selectClip(t.id, cb.clipId);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selection, marker, dispatch, projectStore]);

  // Clear the clip-drag drop indicator when any drag ends (drop or cancel).
  useEffect(() => {
    const clear = () => setDropTarget(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  // Keep the grid filling the panel: track the scroll viewport's width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length]);

  // Cursor-anchored wheel zoom on the time axis (modifier held); plain wheel scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const rect = el.getBoundingClientRect();
      const contentX = e.clientX - rect.left + el.scrollLeft - headerW;
      const beatAtCursor = contentX / pxPerBeat;
      const next = clamp(pxPerBeat * factor, ZOOM.min, ZOOM.max);
      setPxPerBeat(next);
      requestAnimationFrame(() => {
        el.scrollLeft =
          beatAtCursor * next - (e.clientX - rect.left) + headerW;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pxPerBeat, setPxPerBeat, headerW]);

  // Drive the playhead off the audio clock (0 when stopped).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadRef.current;
      if (el) {
        el.style.transform = `translateX(${headerW + beatToX(scheduler.getPositionBeats(), pxPerBeat)}px)`;
        el.style.opacity = scheduler.isPlaying ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scheduler, pxPerBeat, headerW]);

  // Drag the header/lane divider to resize the left header column.
  const onHeaderResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setHeaderW(clamp(ev.clientX - left, HEADER_MIN, HEADER_MAX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const zoomBtn =
    "font-mono text-[12px] leading-none w-6 h-6 rounded border border-line bg-card text-ink cursor-pointer hover:text-bright";

  return (
    <div className="[grid-area:timeline] bg-ground border-t border-line flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-2.5 py-1.5 border-b border-line bg-rail">
        <TransportBar
          projectStore={projectStore}
          scheduler={scheduler}
          dispatch={dispatch}
          isPlaying={isPlaying}
          started={started}
        />
        <span className="w-px h-5 bg-line shrink-0" />
        <button
          type="button"
          onClick={() => dispatch({ type: "createGroup", id: newGroupId() })}
          title="Add a top-level group"
          className="font-mono text-[10px] tracking-wide text-muted border border-line rounded px-1.5 py-0.5 cursor-pointer hover:text-ink"
        >
          + Group
        </button>
        {clipMode && (
          <button
            type="button"
            onClick={() => dispatch({ type: "stopAllClips" })}
            title="Stop all launched clips and play the timeline arrangement"
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-you border border-you/50 bg-you/10 rounded px-2 py-1 cursor-pointer hover:bg-you/20"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-you animate-pulse" />
            Clip mode
            <span className="text-muted">·</span>
            Back to timeline
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 text-muted">
          <label className="flex items-center gap-1.5 font-mono text-[11px]">
            <input
              type="checkbox"
              checked={snapOn}
              onChange={(e) => setSnapOn(e.target.checked)}
            />
            Snap
          </label>
          <select
            value={snapDiv}
            onChange={(e) => setSnapDiv(Number(e.target.value))}
            title="Snap division"
            className="font-mono text-[11px] px-1 py-0.5 rounded border border-line bg-card text-ink"
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="font-mono text-[10px] text-faint">zoom</span>
          <button
            type="button"
            title="Zoom out"
            className={zoomBtn}
            onClick={() =>
              setPxPerBeat(Math.max(ZOOM.min, Math.round(pxPerBeat / 1.25)))
            }
          >
            −
          </button>
          <button
            type="button"
            title="Zoom in"
            className={zoomBtn}
            onClick={() =>
              setPxPerBeat(Math.min(ZOOM.max, Math.round(pxPerBeat * 1.25)))
            }
          >
            +
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 grid place-items-center text-muted text-sm p-5">
          No tracks yet. Add an instrument from the library.
        </div>
      ) : (
        <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          data-testid="arr-scroll"
          className="absolute inset-0 overflow-auto"
        >
          <div
            className="relative"
            style={{ width: headerW + laneWidth, height: contentH }}
          >
            {/* ruler row: sticky top; the corner cell is sticky on both axes */}
            <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
              <div
                className="sticky left-0 z-10 shrink-0 bg-rail border-r border-b border-line"
                style={{ width: headerW, height: RULER_H }}
              />
              <Ruler
                viewBeats={viewBeats}
                loopStart={project.loopStart}
                loopEnd={lengthBeats}
                pxPerBeat={pxPerBeat}
                beatsPerBar={beatsPerBar}
                onSetLoopStart={(beats) =>
                  dispatch({ type: "setLoopStart", beats })
                }
                onSetLoopEnd={(beats) =>
                  dispatch({ type: "setLength", lengthBeats: beats })
                }
              />
            </div>

            {rows.map((row) =>
              row.kind === "group" ? (
                <div key={row.group.id} className="flex">
                  <div
                    className="sticky left-0 z-10 shrink-0"
                    style={{ width: headerW }}
                  >
                    <GroupHeader
                      group={row.group}
                      depth={row.depth}
                      projectStore={projectStore}
                      dispatch={dispatch}
                    />
                  </div>
                  <div
                    className={`${ROW} border-b border-line bg-center/40`}
                    style={{ width: laneWidth }}
                  />
                </div>
              ) : (
                <TrackRow
                  key={row.track.id}
                  meta={row.track}
                  depth={row.depth}
                  selectedTrack={row.track.id === project.selectedTrackId}
                  projectStore={projectStore}
                  dispatch={dispatch}
                  headerW={headerW}
                  laneWidth={laneWidth}
                  pxPerBeat={pxPerBeat}
                  beatsPerBar={beatsPerBar}
                  snapOn={snapOn}
                  snapDiv={snapDiv}
                  selection={selection}
                  markerBeat={
                    marker?.trackId === row.track.id ? marker.beat : null
                  }
                  dropBeat={
                    dropTarget?.trackId === row.track.id
                      ? dropTarget.beat
                      : null
                  }
                  onSelect={selectPlacement}
                  onMark={placeMarker}
                  onHover={(beat) =>
                    setDropTarget(
                      beat === null ? null : { trackId: row.track.id, beat },
                    )
                  }
                />
              ),
            )}

            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 left-0 w-0.5 bg-you pointer-events-none opacity-0 z-5"
            />
          </div>
        </div>
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize the header column"
            onPointerDown={onHeaderResize}
            className="group absolute top-0 bottom-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none"
            style={{ left: headerW }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-line group-hover:w-0.5 group-hover:bg-you" />
          </div>
        </div>
      )}
    </div>
  );
}

/** A track row: the sticky header cell + its editable lane, kept in one flex row. */
function TrackRow({
  meta,
  depth,
  selectedTrack,
  projectStore,
  dispatch,
  headerW,
  laneWidth,
  pxPerBeat,
  beatsPerBar,
  snapOn,
  snapDiv,
  selection,
  markerBeat,
  dropBeat,
  onSelect,
  onMark,
  onHover,
}: {
  meta: TrackMeta;
  depth: number;
  selectedTrack: boolean;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  headerW: number;
  laneWidth: number;
  pxPerBeat: number;
  beatsPerBar: number;
  snapOn: boolean;
  snapDiv: number;
  selection: Selection;
  markerBeat: number | null;
  dropBeat: number | null;
  onSelect: (trackId: string, p: Placement) => void;
  onMark: (trackId: string, beat: number) => void;
  onHover: (beat: number | null) => void;
}) {
  const track = projectStore.getTrack(meta.id);
  return (
    <div className="flex">
      <div className="sticky left-0 z-10 shrink-0" style={{ width: headerW }}>
        <TrackHeader
          track={meta}
          depth={depth}
          selected={selectedTrack}
          projectStore={projectStore}
          dispatch={dispatch}
        />
      </div>
      {track ? (
        <Lane
          track={track}
          width={laneWidth}
          pxPerBeat={pxPerBeat}
          beatsPerBar={beatsPerBar}
          snapOn={snapOn}
          snapDiv={snapDiv}
          selection={selection}
          markerBeat={markerBeat}
          dropBeat={dropBeat}
          onSelect={onSelect}
          onMark={onMark}
          onHover={onHover}
          dispatch={dispatch}
        />
      ) : (
        <div
          className={`${ROW} border-b border-line-soft`}
          style={{ width: laneWidth }}
        />
      )}
    </div>
  );
}
