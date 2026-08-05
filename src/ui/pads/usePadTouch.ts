/**
 * Multi-touch pad playing, with sustain by drag-down (MOBILE-6).
 *
 * One hook behind both pad surfaces (scale pads and a kit's own pads), so a chord, a
 * latch and a release behave the same whatever is drawn on the pad. Notes go out through
 * `LiveNotes`, which is what makes them *recordable*: the same seam the computer keyboard
 * and hardware MIDI use, so it routes to the selected track's instrument and to the
 * recorder without knowing a pad exists.
 *
 * **Sustain: press, drag down past a threshold, and the note latches on.** Drag back up
 * before letting go and it does not. **Playing a new note releases the held ones** -
 * decided 2026-07-31 knowing the limitation, which is that you can then only hold
 * *instead of* playing, never *while* playing, which is the main reason to want sustain.
 * The alternative (latches persist, release is explicit) is a change to `releaseLatched`
 * and nothing else. Ship the simple form, expect to revisit.
 *
 * Pointer Events rather than touch events, and every pad captures its pointer, so a finger
 * that slides off the pad it started on still ends its own note. The pads carry
 * `touch-action: none` for the same reason the sheet's header does: without it the browser
 * claims the drag before the first move arrives, and there is no sustain gesture at all.
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
 * The velocity a pad plays at. A screen has no useful force to read - `PointerEvent.pressure`
 * is 0 or a flat 0.5 on every touch device we have tried - so this is one honest constant
 * rather than a number dressed up as a measurement. Velocity is editable per note in the
 * roll, which is where the nuance belongs on touch (MOBILE-7).
 */
export const PAD_VELOCITY = 0.85;

/** A finger currently down on a pad. */
interface Press {
  pitch: number;
  startY: number;
  /** Dragged far enough that letting go will leave the note sounding. */
  latching: boolean;
}

export interface PadTouch {
  /** Sounding right now, whether held by a finger or latched. */
  isSounding: (pitch: number) => boolean;
  /** Sounding with nothing on it - latched, or about to be if the finger lifts here. */
  isLatched: (pitch: number) => boolean;
  /** Pointer handlers for one pad. */
  padProps: (pitch: number) => {
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
  /** Notes left sounding after the finger lifted. Notes still under a finger are not in here. */
  const latched = useRef(new Set<number>());
  const [sounding, setSounding] = useState<{ pressed: Set<number>; latched: Set<number> }>(() => ({
    pressed: new Set(),
    latched: new Set(),
  }));

  const publish = useCallback(() => {
    const pressed = new Set<number>();
    const latching = new Set(latched.current);
    presses.current.forEach((press) => {
      pressed.add(press.pitch);
      if (press.latching) latching.add(press.pitch);
    });
    setSounding({ pressed, latched: latching });
  }, []);

  /** Silence the latched notes, except any a finger is currently holding down. */
  const releaseLatched = useCallback(() => {
    const held = new Set([...presses.current.values()].map((press) => press.pitch));
    latched.current.forEach((pitch) => {
      if (!held.has(pitch)) target.noteOff(pitch);
    });
    latched.current.clear();
  }, [target]);

  const releaseAll = useCallback(() => {
    presses.current.forEach((press) => target.noteOff(press.pitch));
    presses.current.clear();
    releaseLatched();
    publish();
  }, [publish, releaseLatched, target]);

  const end = useCallback(
    (event: ReactPointerEvent, latch: boolean) => {
      const press = presses.current.get(event.pointerId);
      if (!press) return;
      presses.current.delete(event.pointerId);
      if (latch && press.latching) latched.current.add(press.pitch);
      else target.noteOff(press.pitch);
      publish();
    },
    [publish, target],
  );

  const padProps = useCallback(
    (pitch: number) => ({
      onPointerDown: (event: ReactPointerEvent) => {
        // Capture on the pad, not the surface: a finger that slides onto a neighbour keeps
        // playing the note it started, which is also what stops a slide from stacking voices.
        event.currentTarget.setPointerCapture(event.pointerId);
        releaseLatched();
        presses.current.set(event.pointerId, { pitch, startY: event.clientY, latching: false });
        target.noteOn(pitch, PAD_VELOCITY);
        publish();
      },
      onPointerMove: (event: ReactPointerEvent) => {
        const press = presses.current.get(event.pointerId);
        if (!press) return;
        const latching = event.clientY - press.startY >= SUSTAIN_DRAG_PX;
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
    [end, publish, releaseLatched, target],
  );

  return {
    isSounding: (pitch) => sounding.pressed.has(pitch) || sounding.latched.has(pitch),
    isLatched: (pitch) => sounding.latched.has(pitch),
    padProps,
    releaseAll,
  };
}
