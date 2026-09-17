/**
 * React binding for the MidiInput store (midiInput.ts). The snapshot is a stable
 * reference between changes, so it is a safe external store for useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";
import type { MidiInput, MidiInputState } from "../audio/midi/midiInput";

export function useMidiInput(midiInput: MidiInput): MidiInputState {
  return useSyncExternalStore(midiInput.subscribe, midiInput.getState, midiInput.getState);
}
