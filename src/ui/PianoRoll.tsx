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
 * **Touch has none of the three things that model rests on** - hover, modifiers, and a
 * pointer you can place inside 6px - so it gets the same model reached differently
 * (MOBILE-7): a selected note grows finger-sized end handles and a kebab of actions, and
 * the marquee is off entirely because on a phone that same drag is how you pan. Both live
 * in `editing/ObjectHandles.tsx`. There is no touch *mode*: the affordances are simply sized by
 * pointer type, so a mouse still gets the drag-edge and the marquee it always had.
 *
 * Every multi-note gesture commits through ONE plural command (`editNotes` /
 * `addNotes` / `removeNotes`), so a drag is one undo step and one feed entry. The
 * roll edits the track's active clip; its loop handle sets the CLIP length (the
 * arrangement loop region lives in the timeline). The grid is drawn past the clip
 * end so you can scroll there and drag the end out.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import { anchorZoomX, anchorZoomY } from "./timeline/anchoredZoom";
import { usePinchZoom, type PinchGesture } from "./usePinchZoom";
import { GRID_DIVISIONS, FINEST_DIVISION, quantizeNotes } from "../audio/sequencer/quantize";
import { QUANT_KEYS } from "./quantizeSettings";
import { Menu, type MenuItem } from "./Menu";
import { ObjectHandles } from "./editing/ObjectHandles";
import { Button } from "./controls/Button";
import { IconButton } from "./controls/IconButton";
import { usePublishSurfaceControls } from "./shell/usePublishSurfaceControls";
import { isBlackKey, pitchName } from "./noteNames";

const MIN_PITCH = 24; // C1
const MAX_PITCH = 96; // C7
const ROWS = MAX_PITCH - MIN_PITCH + 1;
/** How long the roll waits for a run of resizes to stop before re-centring on the notes. */
const FIT_SETTLE_MS = 150;
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
  /**
   * How much room a label needs before it earns its place: 0 = always (the octave
   * landmarks), 1 = once rows are comfortable, 2 = only when they are roomy. The pitched
   * roll names all 128 rows, so it sheds the accidentals and then the naturals as you zoom
   * out rather than stacking 9px text into 7px rows. Priority 0 also styles as a landmark.
   * Omitted = every label always shows (a drum kit's pads are sparse and already spaced).
   */
  labelPriority?: (pitch: number) => number;
  /** Pitch range to scroll into view when the clip is empty. */
  frame: { lo: number; hi: number };
  /**
   * Width (px) of a reserved left gutter for the row labels. Both rolls reserve one, so a
   * label never sits on top of a note it is meant to be describing: the pitched roll needs
   * ~34px for "C4", a drum kit needs far more for "C4 Kick". 0/undefined falls back to
   * floating the labels over the grid at the left edge.
   */
  gutter?: number;
};

const CHROMATIC_ROWS: RollRows = {
  label: pitchName,
  highlight: isBlackKey,
  frame: { lo: 57, hi: 64 }, // around middle C
  labelPriority: (pitch) => (pitch % 12 === 0 ? 0 : isBlackKey(pitch) ? 2 : 1),
  // Wide enough for the longest name the range produces, "C#-1".
  gutter: 38,
};

/** Row heights at which the roll starts showing the next tier of labels down. */
const LABEL_TIERS = { naturals: 11, all: 16 };

type Drag =
  | {
      kind: "move" | "resize";
      /** Which end a resize is dragging. Unused by a move, which has no end. */
      edge: "start" | "end";
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
      /**
       * Whether this press may become a marquee. False for touch: a rubber-band selection
       * needs a pointer you can place precisely and a second one to modify with, and on a
       * phone the same drag is how you pan and half of how you pinch - so it fought both.
       * The press still counts as a tap on release, which is what deselects (MOBILE-7).
       */
      allowMarquee: boolean;
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
  compact = false,
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
  /**
   * Touch layout (MOBILE-1): drop the toolbar row and publish its controls to the shell's
   * single ⋮ instead. A 390px screen has no room for snap, grid, quantize and four zoom
   * buttons in a row, and every surface having its own toolbar would stack three of them.
   */
  compact?: boolean;
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
  // Collapsible, because on a short viewport (a phone in landscape leaves the roll ~250px)
  // a 56px lane plus the ruler is most of what there is, and the notes lose the room.
  // Toggled from the roll's settings menu, so it is reachable in both shells.
  //
  // **Closed by default on touch**, where the roll is sharing a sheet with the pads and 56px
  // is a whole row of them. Velocity is not lost by hiding it: it renders as note fill
  // strength, and editing it per note belongs in the note's own menu on touch (MOBILE-7).
  const [velOpen, setVelOpen] = usePersistentBoolean("web-daw:roll-vel-open", !compact);

  // Quantize settings (the grid is the snap-div above). Strength: how far notes pull
  // toward the grid. Ends: snap note ends too. onRecord: snap takes as they're captured.
  const [quantStrength, setQuantStrength] = usePersistentNumber(QUANT_KEYS.strength, 1, 0, 1);
  const [quantEnds, setQuantEnds] = usePersistentBoolean(QUANT_KEYS.ends, false);
  const [quantOnRecord, setQuantOnRecord] = usePersistentBoolean(QUANT_KEYS.onRecord, false);

  // Measure the scroll viewport so the velocity lane can never take most of it. Same
  // guard as the workbench puts on the device rack: a persisted size competing with a
  // flexible one has to be clamped, or a short window lets it win outright.
  const [viewH, setViewH] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const effVelH = viewH ? Math.min(velH, Math.max(VEL.min, Math.round(viewH * 0.4))) : velH;

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
  // How many names the current row height can carry: all of them, the naturals, or just
  // the octave landmarks. Labels are 9px, so 128 of them only fit once rows are roomy.
  const labelTier = rowH >= LABEL_TIERS.all ? 2 : rowH >= LABEL_TIERS.naturals ? 1 : 0;

  const snapB = (b: number) => (snapOn ? snapBeat(b, snapDiv) : b);
  const clampStart = (b: number) => clamp(b, 0, Math.max(0, len - GRID));
  const clampPitch = (p: number) => clamp(p, 0, 127);
  const minNoteLength = snapOn ? snapDiv : GRID;
  const clampLen = (l: number, start: number) => clamp(l, minNoteLength, len - start);

  // Pointer -> grid coordinates (the grid rect already accounts for scroll).
  const beatAt = (clientX: number) =>
    xToBeat(clientX - (gridRef.current?.getBoundingClientRect().left ?? 0), pxPerBeat);
  const pitchAt = (clientY: number) =>
    MAX_PITCH - Math.floor((clientY - (gridRef.current?.getBoundingClientRect().top ?? 0)) / rowH);

  // Fit the clip's notes into view on first load of this track (the component
  // remounts per track, so this runs once each time). Scrolls only - zoom is the
  // user's. Empty clip -> center on middle C.
  //
  // Re-fits on **every** resize until the user scrolls, rather than once on mount, because
  // under the editor sheet (MOBILE-5) the roll is never the right size at mount and is
  // lied to twice on the way up. Parked, its scroller is 0px tall, and centring on no
  // height degenerates to "put the middle row at the top edge". Mid-throw the sheet is
  // held at `height: 100%` and translated (cheap, no relayout), so the roll briefly reads
  // the *whole workspace* - fitting there centres for a viewport twice the one you end up
  // with, which put the notes below the fold at Half while Full stayed tall enough to hide
  // the mistake. Only the settled height is true, and the settle is the last resize.
  //
  // Handing over on the first real scroll is what keeps this from fighting anybody: after
  // that the roll stays exactly where it was put, however the sheet moves.
  //
  // Two guards keep "re-fit on resize" from becoming a scroll generator, because a scroll is
  // not a private event: `Menu` closes on any of them, captured at the window, so a stray
  // fit dismisses whatever popover happens to be opening. Both were found by a CI failure in
  // an unrelated test that opens the roll's settings menu right after expanding the agent
  // panel, which transitions its width over several frames.
  //
  // - **Only a materially changed height re-fits.** Changing the height by `delta` moves the
  //   centred row by `delta / 2`, so the honest test is whether that shift is big enough to
  //   see: more than a row. Expanding the agent panel moved the roll 323 -> 317px, a 3px
  //   shift nobody could notice; a detent change moves it 319 -> 566px. One threshold, in
  //   the unit the thing is actually measured in, separates them.
  // - **Resizes are coalesced.** A transition resizes every frame, so waiting for the burst
  //   to stop means one decision on the final size rather than a scroll per frame. The very
  //   first fit skips the wait, since there is nothing to settle and delaying it would show
  //   the roll uncentred.
  const handedOver = useRef(false);
  const fittedAt = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let selfScroll = false;
    let settle = 0;
    let coalesce: ReturnType<typeof setTimeout> | undefined;
    const fit = () => {
      if (handedOver.current || !el.clientHeight) return;
      if (Math.abs(el.clientHeight - fittedAt.current) < rowH * 2) return;
      fittedAt.current = el.clientHeight;
      const notes = clipStore.getClip().notes;
      const pitches = notes.map((note) => note.pitch);
      const hi = pitches.length ? Math.max(...pitches) : rows.frame.hi;
      const lo = pitches.length ? Math.min(...pitches) : rows.frame.lo;
      const centerRow = (MAX_PITCH - hi + (MAX_PITCH - lo)) / 2;
      selfScroll = true;
      el.scrollTop = clamp(centerRow * rowH + rowH / 2 - el.clientHeight / 2, 0, height - el.clientHeight);
      // Our own write lands as a scroll event within the frame; anything after is the user.
      // Same tell as `useSharedGridScroll` uses to part a restore from a real scroll.
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(() => {
        selfScroll = false;
      });
    };
    const onScroll = () => {
      if (!selfScroll) handedOver.current = true;
    };
    // The observer reports the initial size too, so a roll that already has a height (every
    // desktop mount) fits immediately and behaves exactly as it did before.
    const onResize = () => {
      if (!fittedAt.current) return fit();
      clearTimeout(coalesce);
      coalesce = setTimeout(fit, FIT_SETTLE_MS);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(coalesce);
      cancelAnimationFrame(settle);
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Zoom the time axis about a fixed point. Beat 0 sits at content-x = `gutter` (the reserved
   * label column), so that is the lead.
   */
  const zoomTime = useCallback(
    (factor: number, clientX: number, panPx = 0) => {
      const element = scrollRef.current;
      if (!element) return;
      const next = clamp(pxPerBeat * factor, ZOOM_X.min, ZOOM_X.max);
      setPxPerBeat(next);
      anchorZoomX({ element, clientPosition: clientX, leadPx: gutter, from: pxPerBeat, to: next, panPx });
    },
    [pxPerBeat, gutter, setPxPerBeat],
  );

  /**
   * Zoom the pitch axis. Anchored too, unlike the old wheel path which only rescaled: with a
   * pinch you are holding the rows you are scaling, so an unanchored one slides them out from
   * between your fingers. The ruler is the lead, being the scrollable content above row 0.
   */
  const zoomPitch = useCallback(
    (factor: number, clientY: number, panPx = 0) => {
      const element = scrollRef.current;
      if (!element) return;
      const next = clamp(rowH * factor, ZOOM_Y.min, ZOOM_Y.max);
      setRowH(next);
      anchorZoomY({ element, clientPosition: clientY, leadPx: RULER_H, from: rowH, to: next, panPx });
    },
    [rowH, setRowH],
  );

  // Cursor-anchored wheel zoom (non-passive, so we can preventDefault).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return; // plain wheel = scroll
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      if (e.metaKey && !e.ctrlKey) {
        zoomPitch(factor, e.clientY);
        return;
      }
      // ctrl (trackpad pinch) zooms both axes; shift zooms horizontal only.
      if (e.ctrlKey) zoomPitch(factor, e.clientY);
      zoomTime(factor, e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTime, zoomPitch]);

  // Both axes, because both are continuous scales here: spreading horizontally stretches
  // time, vertically stretches pitch, and a diagonal pinch does each by its own amount.
  // Called on both axes unconditionally, even where the scale is 1: two fingers reposition as
  // well as resize, and skipping an axis whose scale did not change would drop its pan too.
  const onPinch = useCallback(
    ({ scaleX, scaleY, clientX, clientY, panX, panY }: PinchGesture) => {
      zoomTime(scaleX, clientX, panX);
      zoomPitch(scaleY, clientY, panY);
    },
    [zoomTime, zoomPitch],
  );
  usePinchZoom(scrollRef, onPinch);

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

  /**
   * Move or resize the dragged selection, shared by a drag on a note's body and one on a
   * selection handle. Every frame commits through one `editNotes`, so a whole drag is one undo
   * step and one feed entry however many notes it moved.
   */
  const onNoteDragMove = (ev: PointerEvent) => {
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
      return;
    }
    if (!d.moved && dB === 0) return;
    d.moved = true;
    const notes = d.ids.map((id) => {
      const original = d.origin.get(id)!;
      if (d.edge === "end") return { ...original, length: clampLen(original.length + dB, original.start) };
      // Dragging the start end moves the start and leaves the end where it is, which is what
      // taking hold of that end of anything means. Clamped against the note's own end rather
      // than the clip's, so it cannot be dragged inside out.
      const end = original.start + original.length;
      const start = clamp(original.start + dB, 0, end - minNoteLength);
      return { ...original, start, length: end - start };
    });
    if (notes.length === 1) lastLen.current = notes[0].length;
    dispatch({ type: "editNotes", trackId, clipId, notes });
  };

  /** The notes a drag should carry: the selection, or the note being grabbed if it is outside it. */
  const dragTargets = (ids: Set<string>) => {
    const picked = clip.notes.filter((note) => ids.has(note.id));
    return { ids: picked.map((note) => note.id), origin: new Map(picked.map((note) => [note.id, { ...note }])) };
  };

  const onNoteDown = (note: NoteEvent, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const noteRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // The implicit edge is a mouse affordance only. A fingertip covers far more than 6px, so on
    // touch it turned "move this note" into "resize it" whenever you grabbed the right-hand end
    // of a short one - and touch has the handles for that, which are a target you can see.
    const isEdge = e.pointerType === "mouse" && noteRect.right - e.clientX <= RESIZE_PX;

    let sel = new Set(selection);
    if (e.shiftKey) {
      if (sel.has(note.id)) sel.delete(note.id);
      else sel.add(note.id);
    } else if (!sel.has(note.id)) sel = new Set([note.id]);
    setSelection(sel);
    if (e.shiftKey && !sel.has(note.id)) return; // toggled off -> no drag

    drag.current = {
      kind: isEdge ? "resize" : "move",
      edge: "end",
      ...dragTargets(sel),
      startBeat: beatAt(e.clientX),
      startPitch: pitchAt(e.clientY),
      moved: false,
    };
    beginPointerDrag(onNoteDragMove, () => {
      drag.current = null;
    });
  };

  /**
   * Drag the selection from one of its floating grips (MOBILE-7). Exactly the drags a mouse
   * runs on the note itself, entered from targets you can actually hit: from either end, which
   * the implicit edge never offered because there was no room for a second invisible one, and
   * from a grip clear of the note, because a fingertip on a 12px note covers it.
   *
   * The grip's offset from the note does not need accounting for - the drag works in deltas
   * from wherever the finger landed, so the note simply keeps its distance from it.
   */
  const onGripDown = (kind: "move" | "resize", edge: "start" | "end", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = {
      kind,
      edge,
      ...dragTargets(selection),
      startBeat: beatAt(e.clientX),
      startPitch: pitchAt(e.clientY),
      moved: false,
    };
    beginPointerDrag(onNoteDragMove, () => {
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
      allowMarquee: e.pointerType === "mouse",
    };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || (d.kind !== "empty" && d.kind !== "marquee")) return;
      if (!d.moved && Math.hypot(ev.clientX - d.cX, ev.clientY - d.cY) < DRAG_THRESH) return;
      // `moved` is recorded whatever the pointer was, and *before* the marquee gate. It is
      // what tells the release handler this was a drag rather than a tap, so gating it too
      // turned every touch drag - including each finger of a pinch - into a tap, which
      // creates a note. Suppressing the marquee is not the same as pretending nothing moved.
      d.moved = true;
      if (!d.allowMarquee) return;
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

  // --- the selected note's own actions (MOBILE-7) ---------------------------
  // One note only: a group has its own handles and its own answer to what "resize" means, and
  // that is the next slice of this ticket.
  const selectedNote = selection.size === 1 ? (clip.notes.find((note) => selection.has(note.id)) ?? null) : null;

  // Split belongs here too, at the playhead rather than at a tap point - but there is no
  // playhead to split at. `getPositionBeats()` is 0 whenever the transport is stopped and
  // `play()` always anchors to 0, so the position is never inside a note and the row could only
  // ever be disabled. It comes back with DAW-31, which gives the transport a position.

  /** A copy directly after the original, which is the only placement that needs no aiming. */
  const duplicateNote = (note: NoteEvent) => {
    const id = newNoteId();
    dispatch({
      type: "addNotes",
      trackId,
      clipId,
      notes: [{ ...note, id, start: clampStart(note.start + note.length) }],
    });
    setSelection(new Set([id]));
  };

  const noteMenuItems = (note: NoteEvent): MenuItem[] => [
    {
      label: "Velocity",
      fader: {
        // Already a fraction, so the fader's 0..1 needs no conversion.
        position: note.velocity,
        onPosition: (position) =>
          dispatch({ type: "editNotes", trackId, clipId, notes: [{ ...note, velocity: position }] }),
        display: String(Math.round(note.velocity * 100)),
        aria: { now: Math.round(note.velocity * 100), min: 0, max: 100 },
      },
    },
    { separator: true },
    { label: "Duplicate", onClick: () => duplicateNote(note) },
    {
      label: "Delete",
      danger: true,
      onClick: () => {
        dispatch({ type: "removeNotes", trackId, clipId, ids: [note.id] });
        setSelection(new Set());
      },
    },
  ];

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
    const startH = effVelH; // drag from where it actually is, not the unclamped preference
    beginPointerDrag((ev) => setVelH(startH + (startY - ev.clientY)));
  };

  const gridBg = [
    `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${pxPerBeat}px)`,
    `repeating-linear-gradient(90deg, var(--color-line-soft) 0 1px, transparent 1px ${cellW}px)`,
    `repeating-linear-gradient(0deg, var(--color-line-soft) 0 1px, transparent 1px ${rowH}px)`,
  ].join(", ");

  // Quantize the selection (or the whole clip if nothing is selected) to the snap grid,
  // by the current strength, as ONE editNotes command (one undo step, one feed entry).
  const targets = selection.size ? clip.notes.filter((note) => selection.has(note.id)) : clip.notes;
  const quantize = () => {
    if (!targets.length) return;
    const notes = quantizeNotes(targets, { gridBeats: snapDiv, strength: quantStrength, ends: quantEnds });
    dispatch({ type: "editNotes", trackId, clipId, notes });
  };

  /**
   * Snap, quantize and the velocity lane, as data - built as clusters so the same controls
   * can be laid out two ways: flat in the toolbar's kebab on desktop, and folded into named
   * submenus in the shell's single ⋮ on touch, where this list is one of three sharing a
   * menu and every row it does not spend is a row another surface can have.
   *
   * They live in a menu rather than on the toolbar because the toolbar could not hold
   * them: with the agent panel open the row overflowed below ~1150px and pushed the zoom
   * cluster clean out of view, so the controls that got hidden were the ones you reach
   * for most. The toolbar now keeps only the label, this menu and zoom.
   */
  const gridItems: MenuItem[] = [
    { label: "Snap to grid", checked: snapOn, onClick: () => setSnapOn(!snapOn) },
    {
      label: "Grid",
      submenu: GRID_DIVISIONS.map((division) => ({
        label: division.label,
        checked: snapDiv === division.beats,
        onClick: () => setSnapDiv(division.beats),
      })),
    },
  ];
  const quantizeItems: MenuItem[] = [
    {
      label: selection.size ? `Quantize ${selection.size} selected` : "Quantize all notes",
      disabled: !targets.length,
      onClick: quantize,
    },
    {
      label: "Strength",
      submenu: STRENGTH_OPTIONS.map((value) => ({
        label: `${Math.round(value * 100)}%`,
        checked: quantStrength === value,
        onClick: () => setQuantStrength(value),
      })),
    },
    { label: "Quantize note ends", checked: quantEnds, onClick: () => setQuantEnds(!quantEnds) },
    { label: "Auto-quantize recordings", checked: quantOnRecord, onClick: () => setQuantOnRecord(!quantOnRecord) },
  ];
  const velocityItem: MenuItem = { label: "Velocity lane", checked: velOpen, onClick: () => setVelOpen(!velOpen) };

  const rollControls: MenuItem[] = [
    ...gridItems,
    { separator: true },
    ...quantizeItems,
    { separator: true },
    velocityItem,
  ];

  // Touch gets the zoom buttons as menu entries too, since the toolbar is gone there.
  // Each closes the menu, so they are a fallback rather than the gesture: pinch-zoom is
  // the real answer and belongs to MOBILE-2.
  usePublishSurfaceControls(
    "notes",
    [
      ...gridItems,
      { label: "Quantize", submenu: quantizeItems },
      velocityItem,
      {
        label: "Zoom",
        submenu: [
          { label: "Zoom in", onClick: () => setPxPerBeat(Math.round(pxPerBeat * 1.25)) },
          { label: "Zoom out", onClick: () => setPxPerBeat(Math.round(pxPerBeat / 1.25)) },
          { label: "Taller rows", onClick: () => setRowH(rowH + 2) },
          { label: "Shorter rows", onClick: () => setRowH(rowH - 2) },
        ],
      },
    ],
    compact,
  );

  return (
    <div ref={rootRef} className="h-full flex flex-col border border-line rounded-lg bg-stage overflow-hidden">
      {/* toolbar - replaced by the shell's ⋮ when compact (see compactControls above) */}
      <div
        hidden={compact}
        className="flex items-center gap-3 px-2.5 py-1.5 border-b border-line bg-panel shrink-0 text-muted"
      >
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Piano roll</span>
        <Menu items={rollControls} label="Roll settings" align="left" />
        {/* Quantize keeps a button as well as its menu entry: it is the one action here
            you repeat, and it reads the selection, so its label is worth seeing. */}
        <Button
          variant="ghost"
          size="sm"
          title={selection.size ? "Quantize selected notes to the grid" : "Quantize all notes to the grid"}
          className="font-mono"
          disabled={!targets.length}
          onClick={quantize}
        >
          Quantize{selection.size ? " sel" : ""}
        </Button>
        <div className="ml-auto flex items-center gap-0.5">
          <span className="font-mono text-[10px] text-faint mr-1">zoom</span>
          <IconButton
            label="Zoom out (time)"
            size="sm"
            className="font-mono"
            onClick={() => setPxPerBeat(Math.round(pxPerBeat / 1.25))}
          >
            −
          </IconButton>
          <IconButton
            label="Zoom in (time)"
            size="sm"
            className="font-mono"
            onClick={() => setPxPerBeat(Math.round(pxPerBeat * 1.25))}
          >
            +
          </IconButton>
          <IconButton
            label="Shorter rows"
            size="sm"
            className="font-mono text-[11px]"
            onClick={() => setRowH(rowH - 2)}
          >
            ↕−
          </IconButton>
          <IconButton label="Taller rows" size="sm" className="font-mono text-[11px]" onClick={() => setRowH(rowH + 2)}>
            ↕+
          </IconButton>
        </div>
      </div>

      {/* scroll area: ruler (sticky top) + grid + velocity lane (sticky bottom). When a
          label gutter is reserved (drum kits), a sticky-left column holds the row labels
          beside the notes; otherwise the labels float over the grid (display:contents,
          so the layout is identical to a plain roll). */}
      {/* See the arrangement: pinch is ours, one-finger panning stays the browser's. */}
      <div
        ref={scrollRef}
        data-testid="roll-scroll"
        className="flex-1 min-h-0 overflow-auto [touch-action:pan-x_pan-y]"
      >
        <div className={gutter ? "flex" : "contents"} style={gutter ? { width: gutter + width } : undefined}>
          {gutter > 0 && (
            <div className="sticky left-0 z-20 shrink-0 bg-panel border-r border-line" style={{ width: gutter }}>
              <div style={{ height: RULER_H }} />
              <div className="relative" style={{ height }}>
                {Array.from({ length: ROWS }, (_unused, row) => {
                  const pitch = MAX_PITCH - row;
                  const rowLabel = rows.label(pitch);
                  const priority = rows.labelPriority?.(pitch) ?? 0;
                  if (!rowLabel || priority > labelTier) return null;
                  return (
                    <div
                      key={pitch}
                      title={rowLabel}
                      className={`absolute left-0 right-0 flex items-center overflow-hidden truncate px-1.5 font-mono text-[9px] leading-none ${
                        rows.labelPriority ? (priority === 0 ? "text-ink" : "text-faint") : "text-muted"
                      }`}
                      style={{ top: row * rowH, height: rowH }}
                    >
                      {rowLabel}
                    </div>
                  );
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
                className="absolute top-0 bottom-0 bg-recess pointer-events-none"
                style={{ left: beatToX(len, pxPerBeat), width: beatToX(viewBeats - len, pxPerBeat) }}
              />

              {Array.from({ length: ROWS }, (_, row) => {
                const pitch = MAX_PITCH - row;
                const rowLabel = rows.label(pitch);
                return (
                  <div
                    key={pitch}
                    className={`absolute left-0 right-0 pointer-events-none ${rows.highlight(pitch) ? "bg-row-tint" : ""}`}
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
                    className={`absolute rounded-sm box-border cursor-grab border touch-none ${
                      selected ? "bg-strong" : "hover:brightness-125"
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

              {selectedNote && (
                <ObjectHandles
                  name="note"
                  title="Note"
                  left={beatToX(selectedNote.start, pxPerBeat)}
                  right={beatToX(selectedNote.start + selectedNote.length, pxPerBeat)}
                  top={(MAX_PITCH - selectedNote.pitch) * rowH}
                  height={rowH}
                  leadX={gutter}
                  leadY={RULER_H}
                  scrollRef={scrollRef}
                  onResize={(edge, event) => onGripDown("resize", edge, event)}
                  onMove={(event) => onGripDown("move", "end", event)}
                  menuItems={noteMenuItems(selectedNote)}
                />
              )}

              {marquee && (
                <div
                  data-testid="roll-marquee"
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

            {/* velocity lane (collapsible - see velOpen) */}
            <div
              ref={velRef}
              hidden={!velOpen}
              className="sticky bottom-0 z-10 border-t border-line bg-panel"
              style={{ width, height: effVelH }}
              title="Velocity - drag a bar"
            >
              {/* resize the lane by dragging its top edge */}
              <div
                role="separator"
                aria-label="Resize velocity lane"
                onPointerDown={onVelResize}
                className="absolute top-0 left-0 right-0 h-1.5 -mt-0.5 cursor-row-resize hover:bg-you/40 z-10 touch-none"
              />
              {clip.notes.map((note) => {
                const selected = selection.has(note.id);
                return (
                  <div
                    key={note.id}
                    onPointerDown={(e) => onVelDown(note, e)}
                    className={`absolute bottom-0 rounded-t-sm cursor-ns-resize touch-none ${selected ? "bg-strong" : "bg-you/80 hover:bg-you"}`}
                    style={{
                      left: beatToX(note.start, pxPerBeat),
                      width: VEL_BAR_W,
                      height: Math.max(2, note.velocity * (effVelH - 3)),
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
