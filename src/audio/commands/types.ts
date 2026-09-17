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
import type { ServerToBrowser } from "../mcp/protocol";
import type { PatchValues } from "../params/types";
import type { NoteEvent } from "../sequencer/types";

// Who authored an edit. `"claude"` = the MCP / Claude Code driver; `"agent"` = the built-in in-app
// agent (model-agnostic) - two reserved AI voices. `"you"` is the default solo user; any other value is
// a human user id (multi-user). A free string, not a union, so a collaborator's id flows through the
// edit stream as-is; `ReservedVoice` names the ones with fixed meaning/colour.
export type ReservedVoice = "you" | "claude" | "agent";
export type Author = ReservedVoice | (string & {});

/** Protocol messages that are NOT durable edits (navigation / live / transport / history RPC / feed note). */
type NonEditType =
  | "selectTrack"
  | "selectClip"
  | "noteOn"
  | "noteOff"
  | "allNotesOff"
  | "transport"
  | "historyRequest"
  | "patchRequest"
  | "note";

/** The durable-edit subset of the MCP protocol (shapes shared, never duplicated). */
export type ProtocolEdit = Exclude<ServerToBrowser, { type: NonEditType }>;

/** Browser-originated edits with no wire message yet (audio is local-only so far). */
export type LocalEdit =
  | {
      type: "addAudioTrack";
      id: string;
      fileId: string;
      name?: string;
      durationSec?: number;
      startBeat?: number;
      gain?: number;
      groupId?: string;
    }
  | {
      type: "setAudioClip";
      trackId: string;
      clipId?: string;
      patch: { gain?: number; name?: string; loopStartSec?: number; loopEndSec?: number; gridOffsetSec?: number };
    }
  | {
      // Create an EMPTY audio track (no clip yet) - the audio peer of `createTrack`
      // with an empty instrument. Recording a take or dropping a clip fills it later.
      type: "createAudioTrack";
      id: string;
      name?: string;
      groupId?: string;
    }
  | {
      // Add an audio clip (e.g. a recorded take) to an EXISTING audio track's pool
      // and place it. Clip + placement ids are pre-minted by the caller and carried
      // here, so replaying the command reproduces the same ids exactly.
      type: "addAudioClip";
      trackId: string;
      id: string;
      placementId: string;
      fileId: string;
      name?: string;
      durationSec?: number;
      gain?: number;
      startBeat?: number;
    }
  | {
      // Add a note clip (a recorded MIDI take) to an EXISTING instrument track's
      // pool and place it, punching in over whatever it overlaps. Clip + placement
      // ids and every note id are pre-minted by the caller and carried here, so
      // replaying the command reproduces the same ids and notes exactly.
      type: "addNoteClip";
      trackId: string;
      id: string;
      placementId: string;
      name?: string;
      notes: NoteEvent[];
      lengthBeats: number;
      startBeat: number;
    }
  | {
      // Add an instrument track from a saved patch (instrument + params + effect
      // chain). Effect ids are pre-minted by the caller and carried here, so
      // replaying the command reproduces the same track/effect ids exactly.
      type: "createTrackFromPatch";
      id: string;
      name?: string;
      groupId?: string;
      instrumentType: string;
      params: PatchValues;
      effects: { id: string; type: string; bypassed?: boolean; params: PatchValues }[];
      midiDevices?: { id: string; type: string; bypassed?: boolean; params: PatchValues }[];
    }
  | {
      // Apply a patch to an EXISTING instrument track (for auditioning a patch on the
      // current track): replaces its instrument, params, and effect chain, keeping the
      // track's clips, name, and mix. Effect ids are pre-minted by the caller (carried
      // here) so replay reproduces them. `name` is only for the activity-feed phrasing.
      type: "applyPatch";
      trackId: string;
      name?: string;
      instrumentType: string;
      params: PatchValues;
      effects: { id: string; type: string; bypassed?: boolean; params: PatchValues }[];
      midiDevices?: { id: string; type: string; bypassed?: boolean; params: PatchValues }[];
    }
  | {
      // Add an imported sample to the project library. The bytes are already in the
      // content-addressed store (contentHash); the id is pre-minted by the caller so
      // replaying reproduces the same library entry. Browser-only (Node can't hash a
      // local file), so this lives in LocalEdit, not the MCP protocol.
      type: "addSample";
      id: string;
      name: string;
      contentHash: string;
      source?: string;
    }
  | { type: "removeSample"; id: string }
  | {
      // Rename the project. The name is project state (in project.json), so a rename syncs across a
      // shared session and rides undo/redo + history like any edit; meta.json keeps a copy as the
      // library's list index. Browser-only for now (no MCP wire message).
      type: "renameProject";
      name: string;
    };

/** Every durable, authored edit. Serializable by construction. */
export type EditCommand = ProtocolEdit | LocalEdit;

/** One entry in the append-only activity log: an authored, timestamped command. */
export interface EditEntry {
  seq: number;
  command: EditCommand;
  author: Author;
  time: number;
  /** What this entry records. Absent = a normal edit (back-compat). "note" is a feed-only annotation
   *  folded into the one authored stream (text on `command`); skipped by forward replay. */
  kind?: "edit" | "undo" | "redo" | "note";
  /** Display override for non-edit entries (e.g. "Undid: Added note"). */
  label?: string;
}

/** The single mutation entry point handed to the UI and the MCP bridge. */
export type Dispatch = (command: EditCommand, author?: Author) => void;
