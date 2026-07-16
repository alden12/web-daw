/**
 * MIDI-device factories (the runtime side). The AudioEngine calls createMidiDevice to
 * realize a track's chain: each device wraps the next NoteTarget and forwards note
 * events through its transform. Pure catalog data (labels/schemas) lives in catalog.ts
 * so non-runtime consumers (ProjectStore, MCP server) stay DOM-free.
 *
 * Factories are registered, mirroring the data registry in catalog.ts:
 * `registerMidiDeviceFactory` is the runtime half of the extension point.
 */
import type { ParamStore } from "../../params/store";
import { GraphMidiDevice, type NoteTarget } from "./GraphMidiDevice";
import { octavator } from "./devices/octavator";
import { DEFAULT_MIDI_DEVICE } from "./catalog";

type MidiDeviceFactory = (store: ParamStore, next: NoteTarget, secondsPerBeat: () => number) => GraphMidiDevice;

const FACTORIES = new Map<string, MidiDeviceFactory>();

/** Register the runtime factory for a device type (pair with registerMidiDevice). */
export function registerMidiDeviceFactory(type: string, factory: MidiDeviceFactory): void {
  FACTORIES.set(type, factory);
}

export function createMidiDevice(
  type: string,
  store: ParamStore,
  next: NoteTarget,
  secondsPerBeat: () => number,
): GraphMidiDevice {
  const make = FACTORIES.get(type) ?? FACTORIES.get(DEFAULT_MIDI_DEVICE)!;
  return make(store, next, secondsPerBeat);
}

// --- built-in factories (self-registered) ---------------------------------
registerMidiDeviceFactory(
  octavator.type,
  (store, next, secondsPerBeat) => new GraphMidiDevice(octavator, store, next, secondsPerBeat),
);

export {
  midiDeviceInfos,
  midiDeviceSchema,
  midiDeviceCatalogEntry,
  hasMidiDevice,
  DEFAULT_MIDI_DEVICE,
} from "./catalog";
