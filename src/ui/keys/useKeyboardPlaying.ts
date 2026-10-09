/**
 * Playing the computer keyboard (DAW-12.1): key presses become notes or chords through
 * `LiveNotes`, the same seam the pads and hardware MIDI use, so recording and the MIDI devices
 * work without knowing a key was pressed.
 *
 * **A held key remembers what it started.** Moving the octave, changing the key or flipping to
 * chords while a key is down must still let go of the notes that key began, so the release is
 * read from what was played rather than looked up again in the layout.
 *
 * **Two keys can hold the same note** - the rows overlap by design, and chords share notes (C and
 * Am share two) - so a note is only started if nothing holds it yet and only let go once nothing
 * else does, the rule `usePadTouch` keeps for fingers.
 *
 * Shift changes the layout itself (`useShiftHeld`), so the panel shows what a key will play before
 * you press it; a key held through the change keeps sounding what it started. Losing focus (a tab switch, a dialog) lets everything go, since the key-up will never arrive.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTypingTarget } from "../typingTarget";
import { padKey, type PadNoteTarget, type PadNotes } from "../pads/usePadTouch";
import { OCTAVE_KEYS, type KeyPad } from "./keyLayout";

interface HeldKey {
  /** What it is sounding, which the layout may have moved on from since. */
  pitches: PadNotes;
  /** The pad it was pressed as, for lighting it. */
  pad: string;
}

export interface KeyboardPlaying {
  /** Lit by a key held down: matched by the pad's own notes, like `PadTouch.isSounding`. */
  isHeld: (pitches: PadNotes) => boolean;
  /** What a key down right now is sounding, by code: which the layout may no longer show (Shift let go). */
  heldAt: (code: string) => PadNotes | undefined;
}

export function useKeyboardPlaying({
  pads,
  target,
  enabled,
  onOctave,
  velocity,
}: {
  /** The current layout's pads by key code (`padsByCode`). */
  pads: Map<string, KeyPad>;
  target: PadNoteTarget;
  /** Off until audio has started, and while the chord editor has the pads. */
  enabled: boolean;
  onOctave: (direction: -1 | 1) => void;
  /** The velocity a key strikes at, read at the press (the panel's velocity strip). */
  velocity: () => number;
}): KeyboardPlaying {
  const held = useRef(new Map<string, HeldKey>());
  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, HeldKey>>(() => new Map());

  // The listeners read the latest layout and octave handler through refs, so a key change does
  // not tear them down mid-press and lose the key-up.
  const padsRef = useRef(pads);
  const onOctaveRef = useRef(onOctave);
  const velocityRef = useRef(velocity);
  useLayoutEffect(() => {
    padsRef.current = pads;
    onOctaveRef.current = onOctave;
    velocityRef.current = velocity;
  });

  const publish = useCallback(() => setSnapshot(new Map(held.current)), []);
  const heldNotes = useCallback(() => new Set([...held.current.values()].flatMap((key) => [...key.pitches])), []);

  const releaseAll = useCallback(() => {
    const everything = heldNotes();
    held.current.clear();
    everything.forEach((pitch) => target.noteOff(pitch));
    publish();
  }, [heldNotes, publish, target]);

  useEffect(() => {
    if (!enabled) return;
    const onDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // A shortcut (Cmd+A selects all in the roll), not a note.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const octave = OCTAVE_KEYS[event.code];
      const pad = padsRef.current.get(event.code);
      if (octave === undefined && !pad) return;
      // Ours, so no Firefox quick-find on `/` or `'`.
      event.preventDefault();
      if (event.repeat) return;
      if (octave !== undefined) return onOctaveRef.current(octave);
      if (!pad || held.current.has(event.code)) return;
      const sounding = heldNotes();
      const strike = velocityRef.current();
      pad.pitches.filter((pitch) => !sounding.has(pitch)).forEach((pitch) => target.noteOn(pitch, strike));
      held.current.set(event.code, { pitches: pad.pitches, pad: padKey(pad.pitches) });
      publish();
    };
    const onUp = (event: KeyboardEvent) => {
      const key = held.current.get(event.code);
      if (!key) return;
      held.current.delete(event.code);
      const stillHeld = heldNotes();
      key.pitches.filter((pitch) => !stillHeld.has(pitch)).forEach((pitch) => target.noteOff(pitch));
      publish();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [enabled, heldNotes, publish, releaseAll, target]);

  const lit = new Set([...snapshot.values()].map((key) => key.pad));
  return { isHeld: (pitches) => lit.has(padKey(pitches)), heldAt: (code) => snapshot.get(code)?.pitches };
}

/**
 * Shift is held: the octave rows turn into their accidentals while it is. Read off every key
 * event's modifier state rather than the Shift key's own events, so a Shift pressed before the
 * window had focus still counts at the next key.
 */
export function useShiftHeld(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const read = (event: KeyboardEvent) => setHeld(event.getModifierState("Shift"));
    // Shift's key-up may land in another window.
    const drop = () => setHeld(false);
    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("blur", drop);
    };
  }, [enabled]);
  return enabled && held;
}
