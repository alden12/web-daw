/**
 * The MCP bridge wire protocol. Pure types, imported by BOTH the browser bridge
 * and the Node server so the two ends can never drift. Messages are sent as
 * JSON over a WebSocket. Everything is track-addressed (a project has many
 * tracks); transport and tempo are project-level.
 */
import type { ParamValue } from '../params/types';
import type { ClipData, NoteEvent } from '../sequencer/types';
import type { ProjectData } from '../project/types';

/** Sent by the browser tab to the server (state sync). */
export type BrowserToServer =
  | { type: 'projectSnapshot'; project: ProjectData }
  | { type: 'projectStructure'; project: ProjectData }
  | { type: 'paramChanged'; trackId: string; id: string; value: ParamValue }
  | { type: 'clipSnapshot'; trackId: string; clip: ClipData };

/** Sent by the server to the browser tab (commands). */
export type ServerToBrowser =
  // Track structure (id assigned by the creator so both ends agree)
  | { type: 'createTrack'; instrumentType: string; name?: string; id: string }
  | { type: 'removeTrack'; trackId: string }
  | { type: 'selectTrack'; trackId: string }
  | { type: 'setTrack'; trackId: string; muted?: boolean; volume?: number; name?: string }
  // Parameters
  | { type: 'setParam'; trackId: string; id: string; value: ParamValue }
  // Clip editing
  | { type: 'addNote'; trackId: string; note: NoteEvent }
  | { type: 'removeNote'; trackId: string; id: string }
  | { type: 'clearClip'; trackId: string }
  // Live notes (polyphonic)
  | { type: 'noteOn'; trackId: string; midi: number; velocity?: number }
  | { type: 'noteOff'; trackId: string; midi: number }
  | { type: 'allNotesOff' }
  // Transport (project-level)
  | { type: 'setTempo'; bpm: number }
  | { type: 'transport'; action: 'play' | 'stop' };

export const DEFAULT_WS_PORT = 8765;
