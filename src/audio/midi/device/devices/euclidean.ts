/**
 * The Euclidean sequencer: spreads `pulses` hits as evenly as possible across `steps` and
 * plays the held notes on them, in the spirit of a Torso T-1 track. A declarative MIDI device
 * (data, not code) - the `euclid` transform names the schema params the generator strategy
 * reads (see euclid/euclidStrategy.ts). Synced to the transport when playing, free-running
 * from the first note when stopped, exactly like the arpeggiator.
 */
import type { MidiDeviceDef } from "../transform";
import { euclideanSchema } from "../catalog";

export const euclidean: MidiDeviceDef = {
  type: "euclidean",
  schema: euclideanSchema,
  transform: {
    kind: "euclid",
    rate: "rate",
    steps: "steps",
    pulses: "pulses",
    rotate: "rotate",
    repeats: "repeats",
    gate: "gate",
    accent: "accent",
    voicing: "voicing",
  },
};
