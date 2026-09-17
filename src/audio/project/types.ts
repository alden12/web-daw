/**
 * The project model: the structural top of the keystone. A project is a tree of
 * buses (groups) with tracks at the leaves, plus transport state (tempo, loop
 * length). Storage is flat - tracks and groups are kept in arrays and the tree
 * is derived from `parentId` - so the scheduler, engine, and MCP mirror can keep
 * iterating a flat track list while routing and the UI read the hierarchy.
 *
 * A group is structurally a "track-of-tracks": it has its own gain (volume/mute)
 * and effect chain, and reuses the same routing as a track. Tracks always live
 * in a group; groups nest under other groups, with top-level groups (parentId
 * null) summing into the master bus.
 *
 * A track is one of two kinds: an instrument track (a synth driven by a param
 * store, playing a note clip) or an audio track (a recorded/imported audio clip
 * played back as a buffer). Both share the base fields and the effect chain, so
 * they route identically; only the source differs.
 */
import type { NoteEvent } from "../sequencer/types";

// The persisted document types (`ProjectData` and its tree) are inferred from the canonical
// zod schema in ./schema.ts (the single source of truth shared with the sync server) and
// re-exported here so the ~14 importers of project/types are unchanged. The `*Meta` types
// below - the no-payload structural view the UI consumes - are DERIVED from them (via `Omit`),
// so the field lists live in exactly one place: the schema. (The track `*Meta` types are the
// deliberate exception - see the note above them.)
import type {
  ClipAuthor,
  Placement,
  AudioClipData,
  EffectData,
  MidiDeviceData,
  GroupData,
  NoteClipData,
  InstrumentTrackData,
  AudioTrackData,
} from "./schema";

export type {
  ClipAuthor,
  Placement,
  AudioClipData,
  EffectData,
  MidiDeviceData,
  GroupData,
  NoteClipData,
  InstrumentTrackData,
  AudioTrackData,
};
export type { ProjectData, TrackData } from "./schema";

/** An effect in a chain (structural view, no param values). Shared by tracks and groups. */
export type EffectMeta = Omit<EffectData, "params">;

/** A MIDI device in an instrument track's note chain (structural view, no param values). */
export type MidiDeviceMeta = Omit<MidiDeviceData, "params">;

/** A group bus (structural view, no effect param values). `parentId` null = top-level (master). */
export type GroupMeta = Omit<GroupData, "effects"> & { effects: EffectMeta[] };

export type TrackKind = "instrument" | "audio";

// `ClipAuthor` and `Placement` are re-exported from ./schema (above).

/**
 * A clip's portable content for copy/paste (no ids). Kind-tagged so a paste can
 * refuse to cross instrument <-> audio; audio shares the source fileId (no copy).
 */
export type ClipContent =
  | { kind: "instrument"; name: string; notes: NoteEvent[]; lengthBeats: number }
  | { kind: "audio"; name: string; fileId: string; gain: number; durationSec: number };

/** Structural view of a note clip for the UI (no notes payload). */
export type NoteClipMeta = Omit<NoteClipData, "notes">;

// `AudioClipData` is re-exported from ./schema (above); it doubles as the audio-track
// clip data and its structural view (it is light - a file reference, no buffer).

// The track `*Meta` types are the payload-free runtime view: the same identity/base fields as
// the persisted `*Data` types (single-sourced via `Omit`), but with the chain/arrangement fields
// REQUIRED (the live view is always fully populated, unlike the tolerant persisted shape) and
// their element types swapped to the no-payload `*Meta` views. The `params` blob is dropped.
export type InstrumentTrackMeta = Omit<
  InstrumentTrackData,
  "params" | "effects" | "midiDevices" | "clips" | "placements" | "activeClipId" | "launchedClipId"
> & {
  effects: EffectMeta[];
  midiDevices: MidiDeviceMeta[];
  clips: NoteClipMeta[];
  activeClipId: string;
  placements: Placement[];
  launchedClipId: string | null;
};

export type AudioTrackMeta = Omit<
  AudioTrackData,
  "effects" | "clips" | "placements" | "activeClipId" | "launchedClipId"
> & {
  effects: EffectMeta[];
  clips: AudioClipData[];
  activeClipId: string;
  placements: Placement[];
  launchedClipId: string | null;
};

export type TrackMeta = InstrumentTrackMeta | AudioTrackMeta;

// All the persisted data types (`EffectData`, `MidiDeviceData`, `GroupData`, the track `*Data`
// types, `TrackData`, and the `ProjectData` root) are inferred from ./schema.ts and re-exported
// at the top of this file; every `*Meta` view is derived from them there and above.
