/**
 * Hardware MIDI input via the Web MIDI API. Listens to every connected input port
 * and forwards parsed note/pedal events to the handlers (wired in AppShell to the
 * LiveNotes router, the same seam the computer keyboard uses). Holds a small
 * observable state (support / permission / device list) the settings UI subscribes
 * to, mirroring the Recorder's store shape. Browser-only; never imported by the
 * Node MCP server, so the DOM-free rule for the server is untouched.
 *
 * Uses the Web MIDI types from the DOM lib (MIDIAccess/MIDIInput); Safari lacks the
 * API, which we detect and surface rather than crash.
 */
import { parseMidiMessage, SUSTAIN_CC, type MidiMessage } from "./parseMidiMessage";

export type MidiAccessState = "idle" | "requesting" | "granted" | "denied" | "unsupported";

export interface MidiDevice {
  id: string;
  name: string;
  connected: boolean;
}

export interface MidiInputState {
  /** Whether this browser exposes the Web MIDI API at all (Safari does not). */
  supported: boolean;
  access: MidiAccessState;
  devices: MidiDevice[];
  error: string | null;
}

export interface MidiHandlers {
  onNoteOn(note: number, velocity: number): void;
  onNoteOff(note: number): void;
  onSustain(down: boolean): void;
  onPitchBend?(value: number): void;
  onControlChange?(controller: number, value: number): void;
}

export class MidiInput {
  private state: MidiInputState;
  private readonly listeners = new Set<() => void>();
  private readonly handlers: MidiHandlers;
  private access: MIDIAccess | null = null;
  private readonly ports = new Set<MIDIInput>();

  constructor(handlers: MidiHandlers) {
    this.handlers = handlers;
    const supported = typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
    this.state = { supported, access: supported ? "idle" : "unsupported", devices: [], error: null };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = (): MidiInputState => this.state;
  private set(patch: Partial<MidiInputState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Request access (from a user gesture) and start listening to all input ports. */
  async enable(): Promise<void> {
    if (!this.state.supported) return;
    if (this.access) return; // already listening
    this.set({ access: "requesting", error: null });
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.syncPorts();
      this.set({ access: "granted" });
      this.syncPorts();
    } catch {
      this.access = null;
      this.set({ access: "denied", error: "MIDI access was blocked" });
    }
  }

  /** Stop listening and detach every port (leaves permission intact). */
  disable(): void {
    for (const port of this.ports) port.onmidimessage = null;
    this.ports.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.set({ access: this.state.supported ? "idle" : "unsupported", devices: [] });
  }

  /** Attach to every connected input and publish the device list (handles hotplug). */
  private syncPorts(): void {
    if (!this.access) return;
    const inputs = [...this.access.inputs.values()];
    for (const port of inputs) {
      if (this.ports.has(port)) continue;
      port.onmidimessage = (event) => this.handleMessage(event.data);
      this.ports.add(port);
    }
    this.set({
      devices: inputs.map((port) => ({
        id: port.id,
        name: port.name ?? "MIDI device",
        connected: port.state === "connected",
      })),
    });
  }

  private handleMessage(data: Uint8Array | null): void {
    if (!data) return;
    const message = parseMidiMessage(data);
    if (message) DISPATCH[message.type](message as never, this.handlers);
  }
}

// Map-dispatch per message type - each entry routes one parsed message to a handler.
const DISPATCH: { [K in MidiMessage["type"]]: (message: Extract<MidiMessage, { type: K }>, h: MidiHandlers) => void } =
  {
    noteOn: (message, handlers) => handlers.onNoteOn(message.note, message.velocity),
    noteOff: (message, handlers) => handlers.onNoteOff(message.note),
    controlChange: (message, handlers) => {
      if (message.controller === SUSTAIN_CC) handlers.onSustain(message.value >= 0.5);
      else handlers.onControlChange?.(message.controller, message.value);
    },
    pitchBend: (message, handlers) => handlers.onPitchBend?.(message.value),
  };
