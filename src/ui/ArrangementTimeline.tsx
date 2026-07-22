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
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { GroupMeta, Placement, TrackMeta } from "../audio/project/types";
import type { Dispatch } from "../audio/commands/types";
import { newGroupId, newPlacementId, newTrackId } from "../audio/commands/ids";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { Menu } from "./Menu";
import { GROOVES } from "../audio/grooves/catalog";
import { useProject } from "../audio/project/useProject";
import { useRecorder } from "./useRecorder";
import { clamp } from "../util";
import { beginPointerDrag } from "./pointerDrag";
import { useAnimationFrame } from "./useAnimationFrame";
import { TransportBar } from "./TransportBar";
import { Ruler } from "./timeline/Ruler";
import { beatToX } from "./timeline/timeGrid";
import { beatsPerBar as beatsPerBarOf } from "../audio/project/schema";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";
import { GroupHeader, TrackRow } from "./arrangement/rows";
import {
  ROW,
  ROW_PX,
  DEFAULT_HEADER_W,
  HEADER_MIN,
  HEADER_MAX,
  RULER_H,
  TRAIL_BEATS,
  ZOOM,
  SNAP_OPTIONS,
  type Row,
  type Selection,
} from "./arrangement/shared";

/** Depth-first, collapse-aware flatten: subgroups then tracks under each group. */
function flattenRows(groups: GroupMeta[], tracks: TrackMeta[]): Row[] {
  const rows: Row[] = [];
  const walk = (group: GroupMeta, depth: number) => {
    rows.push({ kind: "group", group, depth });
    if (group.collapsed) return;
    for (const sub of groups.filter((child) => child.parentId === group.id)) walk(sub, depth + 1);
    // Tracks sit at their group's depth (not indented one further), so a group and
    // its tracks share the leading gutter and their mute/solo controls line up; the
    // group's distinct styling (uppercase, darker bg) carries the hierarchy.
    for (const track of tracks.filter((track) => track.parentId === group.id))
      rows.push({ kind: "track", track, depth });
  };
  for (const group of groups.filter((group) => group.parentId === null)) walk(group, 0);
  // Defensive: surface any orphaned tracks (model keeps every track in a group).
  for (const track of tracks.filter((track) => !groups.some((group) => group.id === track.parentId)))
    rows.push({ kind: "track", track, depth: 0 });
  return rows;
}

export function ArrangementTimeline({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  // Bring the selected track's row into view (e.g. when selection is driven from the
  // project tree). `nearest` is a no-op when the row is already visible.
  const selectedTrackId = project.selectedTrackId;
  useEffect(() => {
    if (!selectedTrackId) return;
    scrollRef.current
      ?.querySelector(`[data-track-id="${CSS.escape(selectedTrackId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedTrackId]);

  const [pxPerBeat, setPxPerBeat] = usePersistentNumber("web-daw:arr-zoom", 24, ZOOM.min, ZOOM.max);
  const [headerW, setHeaderW] = usePersistentNumber("web-daw:arr-header-w", DEFAULT_HEADER_W, HEADER_MIN, HEADER_MAX);
  const [snapOn, setSnapOn] = usePersistentBoolean("web-daw:arr-snap-on", true);
  const [snapDiv, setSnapDiv] = usePersistentNumber("web-daw:arr-snap-div", 1, 0.5, 4);
  // Recording settings live in the toolbar's settings menu (right). The count-in is
  // a persisted preference pushed to the recorder; the device list/selection are
  // recorder state. (The Record button itself stays in the transport.)
  const [countInBars, setCountInBars] = usePersistentNumber("web-daw:count-in-bars", 1, 0, 2);
  useEffect(() => {
    recorder.setCountInBars(countInBars);
  }, [recorder, countInBars]);
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

  const beatsPerBar = beatsPerBarOf(project.timeSignature);
  const lengthBeats = project.lengthBeats;
  const rows = flattenRows(project.groups, project.tracks);
  const clipMode = project.tracks.some((track) => track.launchedClipId);

  // The grid runs past the loop and the furthest placement (room to arrange into),
  // and never stops short of the visible panel, so the bar grid fills it at any zoom.
  const arrangedEnd = Math.max(
    lengthBeats,
    ...project.tracks.flatMap((track) => track.placements.map((placement) => placement.startBeat + placement.length)),
    0,
  );
  const minViewBeats = pxPerBeat > 0 ? Math.max(0, viewportW - headerW) / pxPerBeat : 0;
  const viewBeats = Math.max(arrangedEnd + TRAIL_BEATS, Math.ceil(minViewBeats));
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
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest("[data-clip-rail]"))) return;
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
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest("[data-clip-rail]"))) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;

      if (key === "c" || key === "x") {
        if (!selection) return;
        const t = projectStore.getTrack(selection.trackId);
        const p = t?.placements.find((placement) => placement.id === selection.id);
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
      const targetId = marker?.trackId ?? selection?.trackId ?? projectStore.selectedId ?? undefined;
      const t = targetId ? projectStore.getTrack(targetId) : undefined;
      if (!cb || !t || !t.clips.some((clip) => clip.id === cb.clipId)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const anchor = selection ? t.placements.find((placement) => placement.id === selection.id) : null;
      const trackEnd = t.placements.reduce(
        (max, placement) => Math.max(max, placement.startBeat + placement.length),
        0,
      );
      const startBeat = marker ? marker.beat : anchor ? anchor.startBeat + anchor.length : trackEnd;
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
        el.scrollLeft = beatAtCursor * next - (e.clientX - rect.left) + headerW;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pxPerBeat, setPxPerBeat, headerW]);

  // Drive the playhead off the audio clock (0 when stopped).
  useAnimationFrame(() => {
    const el = playheadRef.current;
    if (el) {
      el.style.transform = `translateX(${headerW + beatToX(scheduler.getPositionBeats(), pxPerBeat)}px)`;
      el.style.opacity = scheduler.isPlaying ? "1" : "0";
    }
  }, [scheduler, pxPerBeat, headerW]);

  // Drag the header/lane divider to resize the left header column.
  const onHeaderResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    beginPointerDrag((ev) => setHeaderW(clamp(ev.clientX - left, HEADER_MIN, HEADER_MAX)));
  };

  const zoomBtn =
    "font-mono text-[12px] leading-none w-6 h-6 rounded border border-line bg-card text-ink cursor-pointer hover:text-bright";

  // "New <kind> track in ..." submenu: one entry per group plus a fresh group. The
  // caller supplies how to create the track (MIDI vs audio) given a destination group.
  const newTrackSubmenu = (createTrack: (groupId: string) => void) => [
    ...project.groups.map((group) => ({ label: group.name, onClick: () => createTrack(group.id) })),
    {
      label: "New group",
      onClick: () => {
        const groupId = newGroupId();
        dispatch({ type: "createGroup", id: groupId });
        createTrack(groupId);
      },
    },
  ];
  const createMidiTrack = (groupId: string) =>
    dispatch({ type: "createTrack", instrumentType: EMPTY_INSTRUMENT, id: newTrackId(), groupId });
  const createAudioTrack = (groupId: string) => dispatch({ type: "createAudioTrack", id: newTrackId(), groupId });

  return (
    <div className="[grid-area:timeline] bg-ground border-t border-line flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-2.5 py-1.5 border-b border-line bg-rail">
        <TransportBar
          projectStore={projectStore}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          isPlaying={isPlaying}
          started={started}
        />
        <span className="w-px h-5 bg-line shrink-0" />
        <Menu
          label="Timeline options"
          align="left"
          items={[
            {
              label: "Add group",
              onClick: () => dispatch({ type: "createGroup", id: newGroupId() }),
            },
            // Every track lives in a group, so adding one picks the destination group
            // (or a fresh group). Nested as submenus so the menu stays short.
            { label: "New MIDI track in", submenu: newTrackSubmenu(createMidiTrack) },
            { label: "New audio track in", submenu: newTrackSubmenu(createAudioTrack) },
            { separator: true },
            // Recording settings live here too (one toolbar menu, not a second kebab).
            {
              label: "Count-in",
              submenu: [
                {
                  label: "No count-in",
                  checked: countInBars === 0,
                  onClick: () => setCountInBars(0),
                },
                {
                  label: "1 bar",
                  checked: countInBars === 1,
                  onClick: () => setCountInBars(1),
                },
                {
                  label: "2 bars",
                  checked: countInBars === 2,
                  onClick: () => setCountInBars(2),
                },
              ],
            },
            { separator: true },
            // Groove: project-wide swing/feel applied at playback (non-destructive).
            {
              label: "Groove",
              submenu: GROOVES.map((groove) => ({
                label: groove.name,
                checked: project.grooveId === groove.id,
                onClick: () => dispatch({ type: "setGroove", grooveId: groove.id }),
              })),
            },
            {
              label: "Groove amount",
              submenu: [0.25, 0.5, 0.75, 1].map((value) => ({
                label: `${Math.round(value * 100)}%`,
                checked: project.grooveAmount === value,
                onClick: () => dispatch({ type: "setGroove", amount: value }),
              })),
            },
          ]}
        />
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
            <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
            Snap
          </label>
          <select
            value={snapDiv}
            onChange={(e) => setSnapDiv(Number(e.target.value))}
            title="Snap division"
            className="font-mono text-[11px] px-1 py-0.5 rounded border border-line bg-card text-ink"
          >
            {SNAP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="font-mono text-[10px] text-faint">zoom</span>
          <button
            type="button"
            title="Zoom out"
            className={zoomBtn}
            onClick={() => setPxPerBeat(Math.max(ZOOM.min, Math.round(pxPerBeat / 1.25)))}
          >
            −
          </button>
          <button
            type="button"
            title="Zoom in"
            className={zoomBtn}
            onClick={() => setPxPerBeat(Math.min(ZOOM.max, Math.round(pxPerBeat * 1.25)))}
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
          <div ref={scrollRef} data-testid="arr-scroll" className="absolute inset-0 overflow-auto">
            <div className="relative" style={{ width: headerW + laneWidth, height: contentH }}>
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
                  onSetLoopStart={(beats) => dispatch({ type: "setLoopStart", beats })}
                  onSetLoopEnd={(beats) => dispatch({ type: "setLength", lengthBeats: beats })}
                />
              </div>

              {rows.map((row) =>
                row.kind === "group" ? (
                  <div key={row.group.id} className="flex">
                    <div className="sticky left-0 z-10 shrink-0" style={{ width: headerW }}>
                      <GroupHeader
                        group={row.group}
                        depth={row.depth}
                        projectStore={projectStore}
                        dispatch={dispatch}
                      />
                    </div>
                    <div className={`${ROW} border-b border-line bg-center/40`} style={{ width: laneWidth }} />
                  </div>
                ) : (
                  <TrackRow
                    key={row.track.id}
                    meta={row.track}
                    depth={row.depth}
                    selectedTrack={row.track.id === project.selectedTrackId}
                    armed={rec.armedTrackId === row.track.id}
                    onArmToggle={() => recorder.setArmedTrack(rec.armedTrackId === row.track.id ? null : row.track.id)}
                    projectStore={projectStore}
                    dispatch={dispatch}
                    headerW={headerW}
                    laneWidth={laneWidth}
                    pxPerBeat={pxPerBeat}
                    beatsPerBar={beatsPerBar}
                    snapOn={snapOn}
                    snapDiv={snapDiv}
                    selection={selection}
                    markerBeat={marker?.trackId === row.track.id ? marker.beat : null}
                    dropBeat={dropTarget?.trackId === row.track.id ? dropTarget.beat : null}
                    onSelect={selectPlacement}
                    onMark={placeMarker}
                    onHover={(beat) => setDropTarget(beat === null ? null : { trackId: row.track.id, beat })}
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
            // Start below the ruler row: the divider overlaps the loop-start handle
            // (both land at x = headerW when the loop starts at beat 0), and at z-30
            // it would swallow the ruler's loop-marker drags. Leaving the top RULER_H
            // px free keeps the marker row draggable.
            className="group absolute bottom-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none"
            style={{ left: headerW, top: RULER_H }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-line group-hover:w-0.5 group-hover:bg-you" />
          </div>
        </div>
      )}
    </div>
  );
}
