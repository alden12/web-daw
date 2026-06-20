/**
 * The MCP bridge wire protocol. Pure types, imported by BOTH the browser bridge
 * and the Node server so the two ends can never drift. Messages are sent as
 * JSON over a WebSocket.
 */
import type { ParamValue, PatchValues } from '../params/types';
import type { ClipData, NoteEvent } from '../sequencer/types';

/** Sent by the browser tab to the server (state sync). */
export type BrowserToServer =
  | { type: 'snapshot'; values: PatchValues }
  | { type: 'paramChanged'; id: string; value: ParamValue }
  | { type: 'clipSnapshot'; clip: ClipData };

/** Sent by the server to the browser tab (commands). */
export type ServerToBrowser =
  // Parameters
  | { type: 'setParam'; id: string; value: ParamValue }
  // Live notes (polyphonic - noteOff carries the pitch)
  | { type: 'noteOn'; midi: number; velocity?: number }
  | { type: 'noteOff'; midi: number }
  | { type: 'allNotesOff' }
  // Clip editing
  | { type: 'addNote'; note: NoteEvent }
  | { type: 'removeNote'; id: string }
  | { type: 'clearClip' }
  | { type: 'setTempo'; bpm: number }
  // Transport
  | { type: 'transport'; action: 'play' | 'stop' };

export const DEFAULT_WS_PORT = 8765;
