/**
 * The authored edit vocabulary: every durable change to the project, as a
 * serializable command. This is the keystone for undo/redo, the activity feed,
 * version history, and (next) the on-disk file format - all projections of one
 * append-only, authored command stream (DESIGN.md section 1.3).
 *
 * The vocabulary reuses the MCP wire protocol's edit shapes (`ServerToBrowser`)
 * so the two systems can't drift, minus the non-edits (navigation, live notes,
 * transport), plus the browser-only audio edits that have no wire message yet.
 */
import type { ServerToBrowser } from '../mcp/protocol';

export type Author = 'you' | 'claude';

/** Protocol messages that are NOT durable edits (navigation / live / transport). */
type NonEditType = 'selectTrack' | 'noteOn' | 'noteOff' | 'allNotesOff' | 'transport';

/** The durable-edit subset of the MCP protocol (shapes shared, never duplicated). */
export type ProtocolEdit = Exclude<ServerToBrowser, { type: NonEditType }>;

/** Browser-originated edits with no wire message yet (audio is local-only so far). */
export type LocalEdit =
  | {
      type: 'addAudioTrack';
      id: string;
      fileId: string;
      name?: string;
      durationSec?: number;
      startBeat?: number;
      gain?: number;
      groupId?: string;
    }
  | { type: 'setAudioClip'; trackId: string; patch: { startBeat?: number; gain?: number; name?: string } };

/** Every durable, authored edit. Serializable by construction. */
export type EditCommand = ProtocolEdit | LocalEdit;

/** One entry in the append-only log: an authored, timestamped command. */
export interface EditEntry {
  seq: number;
  command: EditCommand;
  author: Author;
  time: number;
}

/** The single mutation entry point handed to the UI and the MCP bridge. */
export type Dispatch = (command: EditCommand, author?: Author) => void;
