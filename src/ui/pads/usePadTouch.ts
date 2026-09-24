/**
 * Multi-touch pad playing, with sustain by drag-down (MOBILE-6).
 *
 * One hook behind both pad surfaces (scale pads and a kit's own pads), so a chord, a
 * latch and a release behave the same whatever is drawn on the pad. Notes go out through
 * `LiveNotes`, which is what makes them *recordable*: the same seam the computer keyboard
 * and hardware MIDI use, so it routes to the selected track's instrument and to the
 * recorder without knowing a pad exists.
 *
 * **Two gestures start the same way, so the first movement picks between them.** Slide
 * sideways and the note follows your finger from pad to pad; drag down and it latches on.
 * They collide by geometry rather than by choice - the pad below a pad is another pad, so
 * "dragged down 34px" and "slid onto the neighbour" are the same event stream - and the fix
 * is the axis lock a scroller uses: whichever way the first `AXIS_LOCK_PX` of travel points
 * is the gesture, for the rest of that finger's press. The cost is that a slide is
 * horizontal only, which is the shape of a glissando anyway.
 *
 * **Sustain: press, drag down past a threshold, and the note latches on.** Drag back up
 * before letting go and it does not. **Playing a new note releases the held ones** -
 * decided 2026-07-31 knowing the limitation, which is that you can then only hold
 * *instead of* playing, never *while* playing, which is the main reason to want sustain.
 * The alternative (latches persist, release is explicit) is a change to `releaseLatched`
 * and nothing else. Ship the simple form, expect to revisit.
 *
 * Pointer Events rather than touch events, and every pad captures its pointer, so a finger
 * that leaves the pads still ends its own note. Capture is also why a slide has to hit-test
 * for itself: the events keep arriving at the pad the finger started on, so the pad it is
 * *over* is `elementFromPoint`'s answer, not the event target's. The pads carry
 * `touch-action: none` for the same reason the sheet's header does: without it the browser
 * claims the drag before the first move arrives, and there is no gesture at all.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Where a pad's notes go. `LiveNotes` satisfies this; a test can pass a spy. */
export interface PadNoteTarget {
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
}

/** How far down you drag before the note latches. Roughly a pad's height, so it is deliberate. */
export const SUSTAIN_DRAG_PX = 34;

/**
 * How far a finger travels before the gesture commits to an axis. Small, because it costs
 * nothing to be wrong for 8px and a slide should start feeling like one immediately - and
 * because the sustain drag is four times further, so it has plenty of room to declare itself.
 */
export const AXIS_LOCK_PX = 8;

/**
 * A pad's notes: one for a note pad, three or more for a chord (MOBILE-12). A pad is known by
 * them - `padKey` - so a chord and the note pads need no id scheme of their own.
 */
export type PadNotes = readonly number[];

/** What identifies a pad, and what it carries in `data-pitches` for a slide to find it by. */
export const padKey = (pitches: PadNotes) => pitches.join(",");

/** The pad under a point, or null where there is none - a gap, or off the section entirely. */
function padAtPoint(clientX: number, clientY: number): PadNotes | null {
  const pad = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-pitches]");
  return pad?.dataset.pitches ? pad.dataset.pitches.split(",").map(Number) : null;
}

/**
 * The velocity a pad plays at. A screen has no useful force to read - `PointerEvent.pressure`
 * is 0 or a flat 0.5 on every touch device we have tried - so this is one honest constant
 * rather than a number dressed up as a measurement. Velocity is editable per note in the
 * roll, which is where the nuance belongs on touch (MOBILE-7).
 */
export const PAD_VELOCITY = 0.85;

/** A finger currently down on a pad. */
interface Press {
  /** The pad it is sounding *now*, which a slide moves out from under it. */
  pitches: PadNotes;
  startX: number;
  startY: number;
  /** Which gesture the finger committed to, once it has moved far enough to say. */
  axis: "slide" | "sustain" | null;
  /** Dragged far enough that letting go will leave the note sounding. */
  latching: boolean;
}

export interface PadTouch {
  /** Sounding right now, whether held by a finger or latched. */
  isSounding: (pitches: PadNotes) => boolean;
  /** Sounding with nothing on it - latched, or about to be if the finger lifts here. */
  isLatched: (pitches: PadNotes) => boolean;
  /** Pointer handlers for one pad. */
  padProps: (pitches: PadNotes) => {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: (event: ReactPointerEvent) => void;
    onPointerCancel: (event: ReactPointerEvent) => void;
  };
  /** Silence everything. Stable, so it can be an effect's cleanup. */
  releaseAll: () => void;
}

export function usePadTouch(target: PadNoteTarget): PadTouch {
  // Every callback below is keyed on `target` alone, which makes them stable for as long as
  // it is - `LiveNotes` is built once in `AppShell`, so that is the whole session.
  // `releaseAll` is used as an effect cleanup, and one that changed identity every render
  // would silence the pads on every unrelated re-render.
  const presses = useRef(new Map<number, Press>());
  /**
   * Pads left sounding after the finger lifted, by `padKey`. Pads still under a finger are not
   * in here.
   */
  const latched = useRef(new Map<string, PadNotes>());
  const [sounding, setSounding] = useState<{ pressed: Set<string>; latched: Set<string> }>(() => ({
    pressed: new Set(),
    latched: new Set(),
  }));

  const publish = useCallback(() => {
    const pressed = new Set<string>();
    const latching = new Set(latched.current.keys());
    presses.current.forEach((press) => {
      pressed.add(padKey(press.pitches));
      if (press.latching) latching.add(padKey(press.pitches));
    });
    setSounding({ pressed, latched: latching });
  }, []);

  /**
   * Every note some pad is holding, but for the pads left out. Two chords share notes (C and Am
   * share two), so a note is only let go once nothing else is holding it, and only started if
   * nothing already is - restarting it would cut the note the other finger is playing.
   */
  const heldNotes = useCallback((exceptPointer?: number, withoutLatched = false) => {
    const held = new Set<number>();
    presses.current.forEach((press, pointerId) => {
      if (pointerId !== exceptPointer) press.pitches.forEach((pitch) => held.add(pitch));
    });
    if (!withoutLatched) latched.current.forEach((pitches) => pitches.forEach((pitch) => held.add(pitch)));
    return held;
  }, []);

  const play = useCallback(
    (pitches: PadNotes, held: Set<number>) =>
      pitches.filter((pitch) => !held.has(pitch)).forEach((pitch) => target.noteOn(pitch, PAD_VELOCITY)),
    [target],
  );
  const letGo = useCallback(
    (pitches: PadNotes, held: Set<number>) =>
      pitches.filter((pitch) => !held.has(pitch)).forEach((pitch) => target.noteOff(pitch)),
    [target],
  );

  /** Silence the latched pads, except any notes a finger is currently holding down. */
  const releaseLatched = useCallback(() => {
    const held = heldNotes(undefined, true);
    latched.current.forEach((pitches) => letGo(pitches, held));
    latched.current.clear();
  }, [heldNotes, letGo]);

  const releaseAll = useCallback(() => {
    const everything = heldNotes(undefined, true);
    presses.current.clear();
    letGo([...everything], new Set());
    releaseLatched();
    publish();
  }, [heldNotes, letGo, publish, releaseLatched]);

  const end = useCallback(
    (event: ReactPointerEvent, latch: boolean) => {
      const press = presses.current.get(event.pointerId);
      if (!press) return;
      presses.current.delete(event.pointerId);
      if (latch && press.latching) latched.current.set(padKey(press.pitches), press.pitches);
      else letGo(press.pitches, heldNotes());
      publish();
    },
    [heldNotes, letGo, publish],
  );

  /**
   * Move a sliding finger to the pad it is now over. Its old notes are released unless another
   * finger is also holding them - a two-handed glissando crosses, and the crossing must not
   * silence the note the other hand is still holding - and a note the two pads share keeps
   * sounding rather than restarting.
   */
  const slideTo = useCallback(
    (event: ReactPointerEvent, press: Press) => {
      const pitches = padAtPoint(event.clientX, event.clientY);
      // No pad under the finger: hold the note rather than cutting out. Sliding through the
      // gap above an accidental is a slide, not a lift.
      if (pitches === null || padKey(pitches) === padKey(press.pitches)) return;
      const heldElsewhere = heldNotes(event.pointerId);
      letGo(press.pitches, new Set([...heldElsewhere, ...pitches]));
      play(pitches, new Set([...heldElsewhere, ...press.pitches]));
      press.pitches = pitches;
      publish();
    },
    [heldNotes, letGo, play, publish],
  );

  const padProps = useCallback(
    (pitches: PadNotes) => ({
      onPointerDown: (event: ReactPointerEvent) => {
        // Capture on the pad, not the surface, so this finger's note is this finger's to end
        // however far it wanders - including off the section entirely.
        event.currentTarget.setPointerCapture(event.pointerId);
        releaseLatched();
        play(pitches, heldNotes());
        presses.current.set(event.pointerId, {
          pitches,
          startX: event.clientX,
          startY: event.clientY,
          axis: null,
          latching: false,
        });
        publish();
      },
      onPointerMove: (event: ReactPointerEvent) => {
        const press = presses.current.get(event.pointerId);
        if (!press) return;
        const acrossPads = event.clientX - press.startX;
        const down = event.clientY - press.startY;
        if (!press.axis) {
          if (Math.max(Math.abs(acrossPads), Math.abs(down)) < AXIS_LOCK_PX) return;
          press.axis = Math.abs(acrossPads) > Math.abs(down) ? "slide" : "sustain";
        }
        if (press.axis === "slide") return slideTo(event, press);
        const latching = down >= SUSTAIN_DRAG_PX;
        // Only re-render when the gesture crosses the threshold, not on every move: the pad
        // shows the latch *before* the finger lifts, so you can see it take and back out.
        if (latching === press.latching) return;
        press.latching = latching;
        publish();
      },
      onPointerUp: (event: ReactPointerEvent) => end(event, true),
      // A cancelled gesture is the browser taking the pointer away, not a decision to hold,
      // so it never latches.
      onPointerCancel: (event: ReactPointerEvent) => end(event, false),
    }),
    [end, heldNotes, play, publish, releaseLatched, slideTo],
  );

  return {
    isSounding: (pitches) => sounding.pressed.has(padKey(pitches)) || sounding.latched.has(padKey(pitches)),
    isLatched: (pitches) => sounding.latched.has(padKey(pitches)),
    padProps,
    releaseAll,
  };
}
