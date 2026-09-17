/**
 * The piano roll: a pitch x time grid for editing a clip with the mouse, plus a
 * bar/beat ruler (with draggable loop-start / loop-end handles), a velocity lane,
 * and zoom.
 *
 * Interaction model (single tool, modifier-driven, like a real DAW):
 * - click empty cell -> add a note; click a note -> select it (shift toggles).
 * - drag a note body -> move; drag its right edge -> resize; drag on empty -> marquee.
 * - Delete removes the selection; Escape / click-outside deselects.
 * - Cmd/Ctrl C/X/V copy / cut / paste; Cmd/Ctrl-A all.
 * - the velocity lane: drag a bar to set velocity (all selected move together); drag
 *   its top edge to resize the lane.
 * - wheel zooms: ctrl/pinch = both axes, Cmd = vertical, Shift = horizontal (cursor-
 *   anchored); plain wheel scrolls.
 *
 * Every multi-note gesture commits through ONE plural command (`editNotes` /
 * `addNotes` / `removeNotes`), so a drag is one undo step and one feed entry. The
 * roll edits the track's active clip; its loop handle sets the CLIP length (the
 * arrangement loop region lives in the timeline). The grid is drawn past the clip
 * end so you can scroll there and drag the end out.
 */
import { useEffect, useRef, useState } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import { noteKey } from "../audio/commands/authorship";
import { authorNoteStyle } from "./authorStyle";
import { useAuthorPresence } from "./authorColorsContext";
import type { ClipStore } from "../audio/sequencer/clipStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import { GRID, type NoteEvent } from "../audio/sequencer/types";
import { useClip } from "../audio/sequencer/useClip";
import { useRecorder } from "./useRecorder";
import type { Dispatch } from "../audio/commands/types";
import { newNoteId } from "../audio/commands/ids";
import { clamp } from "../util";
import { beginPointerDrag } from "./pointerDrag";
import { useAnimationFrame } from "./useAnimationFrame";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";
import { Ruler } from "./timeline/Ruler";
import { beatToX, floorBeat, snapBeat, xToBeat } from "./timeline/timeGrid";
import { GRID_DIVISIONS, FINEST_DIVISION, quantizeNotes } from "../audio/sequencer/quantize";
import { QUANT_KEYS } from "./quantizeSettings";
import { Menu, type MenuItem } from "./Menu";
import { isBlackKey, pitchName } from "./noteNames";

const MIN_PITCH = 24; // C1
const MAX_PITCH = 96; // C7
const ROWS = MAX_PITCH - MIN_PITCH + 1;
const RESIZE_PX = 6; // grab zone on a note's right edge
const DRAG_THRESH = 4; // px before an empty-grid press becomes a marquee
const TRAIL_BEATS = 8; // empty grid drawn past the loop end (room to expand into)
const VEL_BAR_W = 4; // px - a slim velocity marker per note
const RULER_H = 22; // px - matches Ruler's height, for the label-gutter corner spacer

const ZOOM_X = { min: 24, max: 240 };
const ZOOM_Y = { min: 7, max: 28 };
const VEL = { min: 24, max: 160 };

// The note-grid choices (incl. triplets) come from the one shared list, so the snap
// dropdown and the quantize action always offer the same resolutions.
const STRENGTH_OPTIONS = [0.25, 0.5, 0.75, 1];

/**
 * How the roll's pitch rows are labelled, tinted, and framed. The default is the
 * chromatic keyboard (C-names, black-key stripes, framed around middle C); a drum
 * kit passes a mapping so rows read as pad names and frame to the pad range - see
 * DrumRoll.
 */
export type RollRows = {
  /** Left-edge label for a row, or null for none. */
  label: (pitch: number) => string | null;
  /** Rows to tint (black keys, or loaded pads). */
  highlight: (pitch: number) => boolean;
  /** Pitch range to scroll into view when the clip is empty. */
  frame: { lo: number; hi: number };
  /**
   * Width (px) of a reserved left gutter for the row labels. 0/undefined = labels float
   * over the grid at the left edge (the chromatic default); a drum kit reserves a column
   * so the pad names sit beside the notes rather than on top of them.
   */
  gutter?: number;
};

const CHROMATIC_ROWS: RollRows = {
  label: (pitch) => (pitch % 12 === 0 ? pitchName(pitch) : null),
  highlight: isBlackKey,
  frame: { lo: 57, hi: 64 }, // around middle C
};

type Drag =
  | {
      kind: "move" | "resize";
      ids: string[];
      origin: Map<string, NoteEvent>;
      startBeat: number;
      startPitch: number;
      moved: boolean;
    }
  | { kind: "velocity"; ids: string[]; origin: Map<string, NoteEvent>; moved: boolean }
  | {
      kind: "empty" | "marquee";
      downX: number;
      downY: number;
      cX: number;
      cY: number;
      base: Set<string>;
      additive: boolean;
      moved: boolean;
    };

export function PianoRoll({
  clipStore,
  scheduler,
  recorder,
  trackId,
  clipId,
  dispatch,
  projectStore,
  rows = CHROMATIC_ROWS,
}: {
  clipStore: ClipStore;
  scheduler: Scheduler;
  recorder: Recorder;
  trackId: string;
  /** The clip these edits target. Sent explicitly (not left to the receiver's active clip) so note
   *  edits address the same clip on every replica in a shared session, whatever each has selected. */
  clipId: string;
  dispatch: Dispatch;
  /** Supplies per-note last-editor authorship for the voice tint; omit to leave notes untinted. */
  projectStore?: ProjectStore;
  /** Row labelling/tinting/framing; defaults to the chromatic keyboard. */
  rows?: RollRows;
}) {
  const clip = useClip(clipStore);
  const presence = useAuthorPresence();
  // The take in flight, if it is recording into THIS track: its notes overlay the
  // roll live (absolute beats, so they sit under the playhead).
  const rec = useRecorder(recorder);
  const take = rec.take && rec.take.trackId === trackId ? rec.take : null;
  // The roll edits one clip [0, clip length]; the arrangement loop lives in the timeline.
  const len = clip.lengthBeats;
  const viewBeats = len + TRAIL_BEATS;

  const [pxPerBeat, setPxPerBeat] = usePersistentNumber("web-daw:roll-zoom-x", 64, ZOOM_X.min, ZOOM_X.max);
  const [rowH, setRowH] = usePersistentNumber("web-daw:roll-zoom-y", 12, ZOOM_Y.min, ZOOM_Y.max);
  const [snapDiv, setSnapDiv] = usePersistentNumber(QUANT_KEYS.grid, 0.25, FINEST_DIVISION, 1);
  const [snapOn, setSnapOn] = usePersistentBoolean("web-daw:roll-snap-on", true);
  const [velH, setVelH] = usePersistentNumber("web-daw:roll-vel-height", 56, VEL.min, VEL.max);

  // Quantize settings (the grid is the snap-div above). Strength: how far notes pull
  // toward the grid. Ends: snap note ends too. onRecord: snap takes as they're captured.
  const [quantStrength, setQuantStrength] = usePersistentNumber(QUANT_KEYS.strength, 1, 0, 1);
  const [quantEnds, setQuantEnds] = usePersistentBoolean(QUANT_KEYS.ends, false);
  const [quantOnRecord, setQuantOnRecord] = usePersistentBoolean(QUANT_KEYS.onRecord, false);

  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const clipboard = useRef<{ relStart: number; pitch: number; length: number; velocity: number }[]>([]);
  const lastLen = useRef(1);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const heldRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const width = beatToX(viewBeats, pxPerBeat);
  const height = ROWS * rowH;
  const cellW = pxPerBeat * snapDiv;
  const gutter = rows.gutter ?? 0; // reserved left column for row labels (0 = float over the grid)

  const snapB = (b: number) => (snapOn ? snapBeat(b, snapDiv) : b);
  const clampStart = (b: number) => clamp(b, 0, Math.max(0, len - GRID));
  const clampPitch = (p: number) => clamp(p, 0, 127);
  const clampLen = (l: number, start: number) => clamp(l, snapOn ? snapDiv : GRID, len - start);

  // Pointer -> grid coordinates (the grid rect already accounts for scroll).
  const beatAt = (clientX: number) =>
    xToBeat(clientX - (gridRef.current?.getBoundingClientRect().left ?? 0), pxPerBeat);
  const pitchAt = (clientY: number) =>
    MAX_PITCH - Math.floor((clientY - (gridRef.current?.getBoundingClientRect().top ?? 0)) / rowH);

  // Fit the clip's notes into view on first load of this track (the component
  // remounts per track, so this runs once each time). Scrolls only - zoom is the
  // user's. Empty clip -> center on middle C.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const notes = clipStore.getClip().notes;
    const pitches = notes.map((note) => note.pitch);
    const hi = pitches.length ? Math.max(...pitches) : rows.frame.hi;
    const lo = pitches.length ? Math.min(...pitches) : rows.frame.lo;
    const centerRow = (MAX_PITCH - hi + (MAX_PITCH - lo)) / 2;
    requestAnimationFrame(() => {
      el.scrollTop = clamp(centerRow * rowH + rowH / 2 - el.clientHeight / 2, 0, height - el.clientHeight);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cursor-anchored wheel zoom (non-passive, so we can preventDefault).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return; // plain wheel = scroll
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      if (e.metaKey && !e.ctrlKey) {
        setRowH(rowH * factor);
        return;
      }
      // ctrl (pinch) zooms both axes; shift zooms horizontal only.
      if (e.ctrlKey) setRowH(rowH * factor);
      const rect = el.getBoundingClientRect();
      // Beat 0 sits at content-x = gutter (the reserved label column), so anchor off that.
      const contentX = e.clientX - rect.left + el.scrollLeft - gutter;
      const beatAtCursor = contentX / pxPerBeat;
      const next = clamp(pxPerBeat * factor, ZOOM_X.min, ZOOM_X.max);
      setPxPerBeat(next);
      requestAnimationFrame(() => {
        el.scrollLeft = beatAtCursor * next + gutter - (e.clientX - rect.left);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pxPerBeat, rowH, gutter, setPxPerBeat, setRowH]);

  // Drive the playhead off the audio clock (already wrapped to the loop region).
  // While a MIDI take records into this track, also grow the held-note ghosts from
  // their onset out to the playhead, so notes draw in as they are played.
  useAnimationFrame(() => {
    const head = beatToX(scheduler.getPositionBeats(), pxPerBeat);
    const el = playheadRef.current;
    if (el) {
      el.style.transform = `translateX(${head}px)`;
      el.style.opacity = scheduler.isPlaying ? "1" : "0";
    }
    const layer = heldRef.current;
    if (layer) {
      for (const child of Array.from(layer.children) as HTMLElement[]) {
        const left = Number(child.dataset.left);
        child.style.width = `${Math.max(2, head - left)}px`;
      }
    }
  }, [scheduler, pxPerBeat]);

  // Click outside the roll deselects.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setSelection(new Set());
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // Keyboard: delete / deselect / copy / cut / paste / select-all, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      const ids = [...selection];

      if (e.key === "Escape" && ids.length) {
        setSelection(new Set());
      } else if ((e.key === "Delete" || e.key === "Backspace") && ids.length) {
        e.preventDefault();
        dispatch({ type: "removeNotes", trackId, clipId, ids });
        setSelection(new Set());
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(new Set(clip.notes.map((note) => note.id)));
      } else if (mod && (e.key === "c" || e.key === "x") && ids.length) {
        e.preventDefault();
        const picked = clip.notes.filter((note) => selection.has(note.id));
        const base = Math.min(...picked.map((note) => note.start));
        clipboard.current = picked.map((note) => ({
          relStart: note.start - base,
          pitch: note.pitch,
          length: note.length,
          velocity: note.velocity,
        }));
        if (e.key === "x") {
          dispatch({ type: "removeNotes", trackId, clipId, ids });
          setSelection(new Set());
        }
      } else if (mod && e.key === "v" && clipboard.current.length) {
        e.preventDefault();
        const at = snapB(scheduler.getPositionBeats());
        const notes: NoteEvent[] = clipboard.current.map((entry) => ({
          id: newNoteId(),
          pitch: clampPitch(entry.pitch),
          start: clampStart(at + entry.relStart),
          length: entry.length,
          velocity: entry.velocity,
        }));
        dispatch({ type: "addNotes", trackId, clipId, notes });
        setSelection(new Set(notes.map((note) => note.id)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, clip.notes, trackId, dispatch, snapOn, snapDiv, len]);

  // --- note drag (move / resize) -------------------------------------------
  const onNoteDown = (note: NoteEvent, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const noteRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isEdge = noteRect.right - e.clientX <= RESIZE_PX;

    let sel = new Set(selection);
    if (e.shiftKey) {
      if (sel.has(note.id)) sel.delete(note.id);
      else sel.add(note.id);
    } else if (!sel.has(note.id)) sel = new Set([note.id]);
    setSelection(sel);
    if (e.shiftKey && !sel.has(note.id)) return; // toggled off -> no drag

    const ids = [...sel];
    const origin = new Map(ids.map((id) => [id, { ...clip.notes.find((note) => note.id === id)! }]));
    const startBeat = beatAt(e.clientX);
    const startPitch = pitchAt(e.clientY);
    drag.current = { kind: isEdge ? "resize" : "move", ids, origin, startBeat, startPitch, moved: false };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || (d.kind !== "move" && d.kind !== "resize")) return;
      const dB = snapB(beatAt(ev.clientX) - d.startBeat);
      if (d.kind === "move") {
        const dP = pitchAt(ev.clientY) - d.startPitch;
        if (!d.moved && dB === 0 && dP === 0) return;
        d.moved = true;
        const notes = d.ids.map((id) => {
          const original = d.origin.get(id)!;
          return { ...original, start: clampStart(original.start + dB), pitch: clampPitch(original.pitch + dP) };
        });
        dispatch({ type: "editNotes", trackId, clipId, notes });
      } else {
        if (!d.moved && dB === 0) return;
        d.moved = true;
        const notes = d.ids.map((id) => {
          const original = d.origin.get(id)!;
          return { ...original, length: clampLen(original.length + dB, original.start) };
        });
        if (notes.length === 1) lastLen.current = notes[0].length;
        dispatch({ type: "editNotes", trackId, clipId, notes });
      }
    };
    beginPointerDrag(onMove, () => {
      drag.current = null;
    });
  };

  // --- empty-grid press: click -> add, drag -> marquee ----------------------
  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const rect = gridRef.current!.getBoundingClientRect();
    const downX = e.clientX - rect.left;
    const downY = e.clientY - rect.top;
    drag.current = {
      kind: "empty",
      downX,
      downY,
      cX: e.clientX,
      cY: e.clientY,
      base: new Set(selection),
      additive: e.shiftKey,
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || (d.kind !== "empty" && d.kind !== "marquee")) return;
      if (!d.moved && Math.hypot(ev.clientX - d.cX, ev.clientY - d.cY) < DRAG_THRESH) return;
      d.moved = true;
      d.kind = "marquee";
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const x0 = Math.min(d.downX, x);
      const y0 = Math.min(d.downY, y);
      const w = Math.abs(x - d.downX);
      const h = Math.abs(y - d.downY);
      setMarquee({ x: x0, y: y0, w, h });
      const next = new Set(d.additive ? d.base : []);
      for (const note of clip.notes) {
        const nx = beatToX(note.start, pxPerBeat);
        const ny = (MAX_PITCH - note.pitch) * rowH;
        if (nx < x0 + w && nx + beatToX(note.length, pxPerBeat) > x0 && ny < y0 + h && ny + rowH > y0)
          next.add(note.id);
      }
      setSelection(next);
    };
    beginPointerDrag(onMove, () => {
      const d = drag.current;
      drag.current = null;
      setMarquee(null);
      if (!d || (d.kind !== "empty" && d.kind !== "marquee")) return;
      if (d.moved || d.additive) return; // dragged (marquee), or shift-click: keep selection
      const pitch = MAX_PITCH - Math.floor(downY / rowH);
      const beat = xToBeat(downX, pxPerBeat);
      if (pitch < MIN_PITCH || pitch > MAX_PITCH || beat >= len) {
        setSelection(new Set()); // outside the note range / past the loop end: just deselect
        return;
      }
      const id = newNoteId();
      const start = clampStart(floorBeat(beat, snapOn ? snapDiv : GRID));
      dispatch({
        type: "addNote",
        trackId,
        clipId,
        note: { id, pitch, start, length: lastLen.current, velocity: 0.8 },
      });
      setSelection(new Set([id]));
    });
  };

  // --- velocity lane --------------------------------------------------------
  const onVelDown = (note: NoteEvent, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ids = selection.has(note.id) ? [...selection] : [note.id];
    setSelection(new Set(ids));
    const origin = new Map(ids.map((id) => [id, { ...clip.notes.find((note) => note.id === id)! }]));
    drag.current = { kind: "velocity", ids, origin, moved: false };

    const apply = (clientY: number) => {
      const rect = velRef.current!.getBoundingClientRect();
      const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
      const notes = ids.map((id) => ({ ...origin.get(id)!, velocity: v }));
      dispatch({ type: "editNotes", trackId, clipId, notes });
    };
    apply(e.clientY);
    beginPointerDrag(
      (ev) => apply(ev.clientY),
      () => {
        drag.current = null;
      },
    );
  };

  // Drag the velocity lane's top edge to resize it.
  const onVelResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = velH;
    beginPointerDrag((ev) => setVelH(startH + (startY - ev.clientY)));
  };

  const gridBg = [
    `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${pxPerBeat}px)`,
    `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${cellW}px)`,
    `repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${rowH}px)`,
  ].join(", ");

  // Quantize the selection (or the whole clip if nothing is selected) to the snap grid,
  // by the current strength, as ONE editNotes command (one undo step, one feed entry).
  const targets = selection.size ? clip.notes.filter((note) => selection.has(note.id)) : clip.notes;
  const quantize = () => {
    if (!targets.length) return;
    const notes = quantizeNotes(targets, { gridBeats: snapDiv, strength: quantStrength, ends: quantEnds });
    dispatch({ type: "editNotes", trackId, clipId, notes });
  };

  const settingsItems: MenuItem[] = [
    {
      label: "Strength",
      submenu: STRENGTH_OPTIONS.map((value) => ({
        label: `${Math.round(value * 100)}%`,
        checked: quantStrength === value,
        onClick: () => setQuantStrength(value),
      })),
    },
    { label: "Quantize note ends", checked: quantEnds, onClick: () => setQuantEnds(!quantEnds) },
    { separator: true },
    { label: "Auto-quantize recordings", checked: quantOnRecord, onClick: () => setQuantOnRecord(!quantOnRecord) },
  ];

  const zoomBtn =
    "font-mono text-[12px] leading-none w-6 h-6 rounded border border-line bg-card text-ink cursor-pointer hover:text-bright";
  const toolBtn =
    "font-mono text-[11px] leading-none px-2 h-6 rounded border border-line bg-card text-ink cursor-pointer hover:text-bright";

  return (
    <div ref={rootRef} className="h-full flex flex-col border border-line rounded-lg bg-ground overflow-hidden">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-2.5 py-1.5 border-b border-line bg-rail shrink-0 text-muted">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Piano roll</span>
        <label className="flex items-center gap-1.5 font-mono text-[11px]">
          <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
          Snap
        </label>
        <select
          value={snapDiv}
          onChange={(e) => setSnapDiv(Number(e.target.value))}
          className="font-mono text-[11px] px-1 py-0.5 rounded border border-line bg-card text-ink"
        >
          {GRID_DIVISIONS.map((division) => (
            <option key={division.label} value={division.beats}>
              {division.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title={selection.size ? "Quantize selected notes to the grid" : "Quantize all notes to the grid"}
          className={toolBtn}
          disabled={!targets.length}
          onClick={quantize}
        >
          Quantize{selection.size ? " sel" : ""}
        </button>
        <button
          type="button"
          title="Auto-quantize notes as they're recorded"
          aria-pressed={quantOnRecord}
          className={`${toolBtn} ${quantOnRecord ? "border-you text-you" : ""}`}
          onClick={() => setQuantOnRecord(!quantOnRecord)}
        >
          Auto-Q
        </button>
        <Menu items={settingsItems} label="Quantize settings" align="left" />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-faint">zoom</span>
          <button
            type="button"
            title="Zoom out (time)"
            className={zoomBtn}
            onClick={() => setPxPerBeat(Math.round(pxPerBeat / 1.25))}
          >
            −
          </button>
          <button
            type="button"
            title="Zoom in (time)"
            className={zoomBtn}
            onClick={() => setPxPerBeat(Math.round(pxPerBeat * 1.25))}
          >
            +
          </button>
          <button type="button" title="Shorter rows" className={zoomBtn} onClick={() => setRowH(rowH - 2)}>
            ↕−
          </button>
          <button type="button" title="Taller rows" className={zoomBtn} onClick={() => setRowH(rowH + 2)}>
            ↕+
          </button>
        </div>
      </div>

      {/* scroll area: ruler (sticky top) + grid + velocity lane (sticky bottom). When a
          label gutter is reserved (drum kits), a sticky-left column holds the row labels
          beside the notes; otherwise the labels float over the grid (display:contents,
          so the layout is identical to a plain roll). */}
      <div ref={scrollRef} data-testid="roll-scroll" className="flex-1 min-h-0 overflow-auto">
        <div className={gutter ? "flex" : "contents"} style={gutter ? { width: gutter + width } : undefined}>
          {gutter > 0 && (
            <div className="sticky left-0 z-6 shrink-0 bg-rail border-r border-line" style={{ width: gutter }}>
              <div style={{ height: RULER_H }} />
              <div className="relative" style={{ height }}>
                {Array.from({ length: ROWS }, (_unused, row) => {
                  const pitch = MAX_PITCH - row;
                  const rowLabel = rows.label(pitch);
                  return rowLabel ? (
                    <div
                      key={pitch}
                      title={rowLabel}
                      className="absolute left-0 right-0 flex items-center truncate px-1.5 font-mono text-[9px] leading-none text-muted"
                      style={{ top: row * rowH, height: rowH }}
                    >
                      {rowLabel}
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
          <div className={gutter ? "shrink-0" : "contents"} style={gutter ? { width } : undefined}>
            <Ruler
              viewBeats={viewBeats}
              loopStart={0}
              loopEnd={len}
              pxPerBeat={pxPerBeat}
              timeSignature={projectStore?.timeSignature}
              onSetLoopEnd={(beats) => dispatch({ type: "setClipLength", trackId, lengthBeats: beats })}
            />

            <div
              ref={gridRef}
              data-testid="piano-grid"
              className="relative cursor-copy"
              style={{ width, height, background: gridBg }}
              onPointerDown={onGridDown}
            >
              {/* dim the grid past the clip's end (drag the ruler handle to extend) */}
              <div
                className="absolute top-0 bottom-0 bg-black/25 pointer-events-none"
                style={{ left: beatToX(len, pxPerBeat), width: beatToX(viewBeats - len, pxPerBeat) }}
              />

              {Array.from({ length: ROWS }, (_, row) => {
                const pitch = MAX_PITCH - row;
                const rowLabel = rows.label(pitch);
                return (
                  <div
                    key={pitch}
                    className={`absolute left-0 right-0 pointer-events-none ${rows.highlight(pitch) ? "bg-white/[0.035]" : ""}`}
                    style={{ top: row * rowH, height: rowH }}
                  >
                    {rowLabel && gutter === 0 && (
                      <span className="sticky left-0.5 z-1 font-mono text-[9px] text-muted pl-0.5">{rowLabel}</span>
                    )}
                  </div>
                );
              })}

              {clip.notes.map((note) => {
                const selected = selection.has(note.id);
                // Tint the note by its last editor. Falls back to "you" when unstamped.
                const author = projectStore?.authorOf(noteKey(note.id)) ?? "you";
                return (
                  <div
                    key={note.id}
                    data-testid="note"
                    onPointerDown={(e) => onNoteDown(note, e)}
                    className={`absolute rounded-sm box-border cursor-grab border ${
                      selected ? "bg-bright" : "hover:brightness-125"
                    }`}
                    style={{
                      ...authorNoteStyle(author, selected, presence),
                      left: beatToX(note.start, pxPerBeat),
                      width: Math.max(2, beatToX(note.length, pxPerBeat) - 1),
                      top: (MAX_PITCH - note.pitch) * rowH,
                      height: rowH - 1,
                      opacity: 0.45 + 0.55 * note.velocity,
                    }}
                    title={`${rows.label(note.pitch) ?? pitchName(note.pitch)} · ${note.start}+${note.length} beats · vel ${note.velocity.toFixed(2)}`}
                  >
                    <div className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize" />
                  </div>
                );
              })}

              {marquee && (
                <div
                  className="absolute border border-you/70 bg-you/10 pointer-events-none"
                  style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                />
              )}

              {/* Live record overlay: notes captured so far (static) plus the notes still
              held (grown out to the playhead each frame). Drawn in the record colour. */}
              {take && (
                <>
                  {take.captured.map((note, i) => (
                    <div
                      key={`cap-${i}`}
                      data-testid="ghost-note"
                      className="absolute rounded-sm bg-claude/70 border border-claude pointer-events-none z-4"
                      style={{
                        left: beatToX(note.startBeat, pxPerBeat),
                        width: Math.max(2, beatToX(note.endBeat - note.startBeat, pxPerBeat) - 1),
                        top: (MAX_PITCH - note.pitch) * rowH,
                        height: rowH - 1,
                      }}
                    />
                  ))}
                  <div ref={heldRef} className="contents">
                    {take.held.map((note) => (
                      <div
                        key={`held-${note.pitch}`}
                        data-testid="ghost-note"
                        data-left={beatToX(note.startBeat, pxPerBeat)}
                        className="absolute rounded-sm bg-claude border border-claude pointer-events-none z-4 animate-pulse"
                        style={{
                          left: beatToX(note.startBeat, pxPerBeat),
                          width: 2,
                          top: (MAX_PITCH - note.pitch) * rowH,
                          height: rowH - 1,
                        }}
                      />
                    ))}
                  </div>
                </>
              )}

              <div
                ref={playheadRef}
                className="absolute top-0 left-0 w-0.5 bg-you pointer-events-none opacity-0 z-5"
                style={{ height }}
              />
            </div>

            {/* velocity lane */}
            <div
              ref={velRef}
              className="sticky bottom-0 z-10 border-t border-line bg-rail"
              style={{ width, height: velH }}
              title="Velocity - drag a bar"
            >
              {/* resize the lane by dragging its top edge */}
              <div
                role="separator"
                aria-label="Resize velocity lane"
                onPointerDown={onVelResize}
                className="absolute top-0 left-0 right-0 h-1.5 -mt-0.5 cursor-row-resize hover:bg-you/40 z-10"
              />
              {clip.notes.map((note) => {
                const selected = selection.has(note.id);
                return (
                  <div
                    key={note.id}
                    onPointerDown={(e) => onVelDown(note, e)}
                    className={`absolute bottom-0 rounded-t-sm cursor-ns-resize ${selected ? "bg-bright" : "bg-you/80 hover:bg-you"}`}
                    style={{
                      left: beatToX(note.start, pxPerBeat),
                      width: VEL_BAR_W,
                      height: Math.max(2, note.velocity * (velH - 3)),
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
