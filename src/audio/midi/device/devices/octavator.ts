/**
 * The Octavator: doubles each note an octave up and/or down at a scaled velocity.
 * A declarative MIDI device (data, not code) - a fan-out `tap` transform whose octave
 * copies are gated by boolean params and scaled by `level`. The dry tap (0 semitones)
 * always passes through. Octaves are key-agnostic, so it ignores any project key.
 */
import type { MidiDeviceDef } from "../transform";
import { octavatorSchema } from "../catalog";

export const octavator: MidiDeviceDef = {
  type: "octavator",
  schema: octavatorSchema,
  transform: {
    kind: "tap",
    taps: [
      { semitones: 0 },
      { semitones: 12, enabled: { param: "octaveUp" }, velocityScale: { param: "level" } },
      { semitones: -12, enabled: { param: "octaveDown" }, velocityScale: { param: "level" } },
    ],
  },
};
