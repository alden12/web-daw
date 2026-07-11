/**
 * The Arpeggiator: holds a chord and plays its notes one at a time on the tempo grid,
 * cycling a pattern. A declarative MIDI device (data, not code) - the `arpeggiate`
 * transform names the schema params the generator strategy reads (see arp/arpStrategy.ts).
 * Synced to the transport when playing, free-running from the first note when stopped.
 */
import type { MidiDeviceDef } from "../transform";
import { arpeggiatorSchema } from "../catalog";

export const arpeggiator: MidiDeviceDef = {
  type: "arpeggiator",
  schema: arpeggiatorSchema,
  transform: { kind: "arpeggiate", rate: "rate", pattern: "pattern", octaves: "octaves", gate: "gate" },
};
