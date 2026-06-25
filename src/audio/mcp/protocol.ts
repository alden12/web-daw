/**
 * The MCP bridge wire protocol. Pure types, imported by BOTH the browser bridge
 * and the Node server so the two ends can never drift. Messages are sent as
 * JSON over a WebSocket. The project is a tree of groups (buses) with tracks at
 * the leaves: tracks and groups are addressed by id; effects attach to a "host"
 * (a track or a group) addressed by `hostId`; transport and tempo are
 * project-level.
 */
import type { ParamValue } from '../params/types';
import type { ClipData, NoteEvent } from '../sequencer/types';
import type { ProjectData } from '../project/types';

/** Sent by the browser tab to the server (state sync). */
export type BrowserToServer =
  | { type: 'projectSnapshot'; project: ProjectData }
  | { type: 'projectStructure'; project: ProjectData }
  | { type: 'paramChanged'; trackId: string; id: string; value: ParamValue }
  | { type: 'clipSnapshot'; trackId: string; clipId: string; clip: ClipData }
  | { type: 'effectParamChanged'; hostId: string; effectId: string; id: string; value: ParamValue };

/** Sent by the server to the browser tab (commands). */
export type ServerToBrowser =
  // Track structure (id assigned by the creator so both ends agree)
  | { type: 'createTrack'; instrumentType: string; name?: string; id: string; groupId?: string }
  | { type: 'removeTrack'; trackId: string }
  | { type: 'selectTrack'; trackId: string }
  | { type: 'setTrack'; trackId: string; muted?: boolean; volume?: number; name?: string }
  // Group structure (bus tree; id assigned by the creator so both ends agree)
  | { type: 'createGroup'; id: string; name?: string; parentId?: string | null }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'setGroup'; groupId: string; name?: string; muted?: boolean; volume?: number; collapsed?: boolean }
  | { type: 'moveTrack'; trackId: string; groupId: string }
  | { type: 'moveGroup'; groupId: string; parentId: string | null }
  // Parameters
  | { type: 'setParam'; trackId: string; id: string; value: ParamValue }
  // Effect chain on a host (track or group; effect id assigned by the creator)
  | { type: 'addEffect'; hostId: string; effectType: string; id: string }
  | { type: 'removeEffect'; hostId: string; effectId: string }
  | { type: 'moveEffect'; hostId: string; effectId: string; toIndex: number }
  | { type: 'bypassEffect'; hostId: string; effectId: string; bypassed: boolean }
  | { type: 'setEffectParam'; hostId: string; effectId: string; id: string; value: ParamValue }
  // Clip note editing. `clipId` is optional - omit it to target the track's active
  // clip. Plural forms (addNotes / editNotes / removeNotes) are one atomic edit
  // each - one feed entry, one undo step - so writing a part or a multi-note
  // drag/delete don't flood the history.
  | { type: 'addNote'; trackId: string; clipId?: string; note: NoteEvent }
  | { type: 'addNotes'; trackId: string; clipId?: string; notes: NoteEvent[] }
  | { type: 'editNotes'; trackId: string; clipId?: string; notes: NoteEvent[] }
  | { type: 'removeNote'; trackId: string; clipId?: string; id: string }
  | { type: 'removeNotes'; trackId: string; clipId?: string; ids: string[] }
  | { type: 'clearClip'; trackId: string; clipId?: string }
  | { type: 'setClipLength'; trackId: string; clipId?: string; lengthBeats: number }
  // Clip pool (note patterns / launchable slots)
  | { type: 'addClip'; trackId: string; id: string; name?: string; fromClipId?: string; empty?: boolean; lengthBeats?: number }
  | { type: 'selectClip'; trackId: string; clipId: string }
  | { type: 'removeClip'; trackId: string; clipId: string }
  | { type: 'renameClip'; trackId: string; clipId: string; name: string }
  // Arrangement placements (clip regions along time)
  | { type: 'addPlacement'; trackId: string; id: string; clipId?: string; startBeat: number; offset?: number; length?: number }
  | { type: 'movePlacement'; trackId: string; placementId: string; startBeat: number }
  | { type: 'resizePlacement'; trackId: string; placementId: string; offset?: number; length?: number }
  | { type: 'removePlacement'; trackId: string; placementId: string }
  | { type: 'splitPlacement'; trackId: string; placementId: string; atBeat: number; newId: string }
  // Live notes (polyphonic)
  | { type: 'noteOn'; trackId: string; midi: number; velocity?: number }
  | { type: 'noteOff'; trackId: string; midi: number }
  | { type: 'allNotesOff' }
  // Transport (project-level)
  | { type: 'setTempo'; bpm: number }
  | { type: 'setLength'; lengthBeats: number }
  | { type: 'setLoopStart'; beats: number }
  | { type: 'transport'; action: 'play' | 'stop' };

export const DEFAULT_WS_PORT = 8765;
