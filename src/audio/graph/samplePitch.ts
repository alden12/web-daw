/**
 * How fast a `buffer` node plays its sample for a note (INST-13): at its own pitch on `root`, an
 * octave faster per octave above it. Pure, so it is tested without an audio context.
 */
import { midiToFreq } from "../instruments/binding";

/** The playback rate for a note of `noteFreq` Hz, against a MIDI `root`; unity without keytracking. */
export const playbackRateFor = (noteFreq: number, root: number, keytrack: boolean): number =>
  keytrack ? noteFreq / midiToFreq(root) : 1;
