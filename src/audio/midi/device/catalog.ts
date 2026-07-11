/**
 * The MIDI-device catalog: pure data (labels + parameter schemas), no audio/DOM.
 * Mirrors effects/catalog.ts so the ProjectStore and the Node MCP server can consume
 * device schemas without Web Audio types. The runtime interpreter (GraphMidiDevice)
 * and its factory live in registry.ts.
 *
 * Devices are registered, not hardcoded: built-ins self-register below and
 * `registerMidiDevice` is the extension point. Each device's note transform lives with
 * its def in devices/ (registry.ts wires the factory); only the schema is data here.
 */
import type { ParamSchema } from "../../params/types";

export const octavatorSchema: ParamSchema = [
  { id: "octaveUp", label: "Octave up", kind: "boolean", default: true },
  { id: "octaveDown", label: "Octave down", kind: "boolean", default: false },
  { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear" },
] as const;

export const arpeggiatorSchema: ParamSchema = [
  {
    id: "rate",
    label: "Rate",
    kind: "enum",
    options: ["1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32"],
    default: "1/8",
  },
  { id: "pattern", label: "Pattern", kind: "enum", options: ["up", "down", "updown", "random"], default: "up" },
  { id: "octaves", label: "Octaves", kind: "number", min: 1, max: 4, default: 1, step: 1, taper: "linear" },
  { id: "gate", label: "Gate", kind: "number", min: 0.05, max: 1, default: 0.5, taper: "linear" },
] as const;

export interface MidiDeviceInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
}

/** The MIDI-device data registry (insertion order = palette / add-button order). */
const REGISTRY = new Map<string, MidiDeviceInfo>();

/** Register a device's data (label + schema). The runtime factory is registered
 *  separately in registry.ts, so this stays DOM-free for the server. */
export function registerMidiDevice(info: MidiDeviceInfo): void {
  REGISTRY.set(info.type, info);
}

/** Every registered device, in registration order (iterate this, never hardcode). */
export function midiDeviceInfos(): MidiDeviceInfo[] {
  return [...REGISTRY.values()];
}

/** Whether a device type is registered. */
export function hasMidiDevice(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_MIDI_DEVICE = "octavator";

export function midiDeviceCatalogEntry(type: string): MidiDeviceInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_MIDI_DEVICE)!;
}

export function midiDeviceSchema(type: string): ParamSchema {
  return midiDeviceCatalogEntry(type).schema;
}

// --- built-in MIDI devices (self-registered) ------------------------------
registerMidiDevice({ type: "octavator", label: "Octavator", schema: octavatorSchema });
registerMidiDevice({ type: "arpeggiator", label: "Arpeggiator", schema: arpeggiatorSchema });
