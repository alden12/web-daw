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
import type { PatchValues } from "../params/types";
import type { NoteEvent } from "../sequencer/types";

/** An effect in a chain (structural view, no param values). Shared by tracks and groups. */
export interface EffectMeta {
  id: string;
  type: string;
  bypassed: boolean;
}

/** A group bus (structural view). `parentId` null means top-level (sums to master). */
export interface GroupMeta {
  id: string;
  name: string;
  /** Parent group id, or null for a top-level group routed to master. */
  parentId: string | null;
  collapsed: boolean;
  muted: boolean;
  /** Solo: if anything is soloed, only solo-active buses sound. */
  solo: boolean;
  /** 0..1 group bus output gain. */
  volume: number;
  /** Insert effects on the group bus, between its children's sum and its gain. */
  effects: EffectMeta[];
}

export type TrackKind = "instrument" | "audio";

/** Who authored a piece of durable state (two-voice presence). Mirrors commands/types Author. */
export type ClipAuthor = "you" | "claude";

/**
 * A placement of a clip on a track's arrangement timeline. The same clip can be
 * placed multiple times. `offset`/`length` window into the clip (beats) so a
 * placement can be split or trimmed without touching the underlying clip.
 */
export interface Placement {
  id: string;
  clipId: string;
  /** Onset on the arrangement, in beats. */
  startBeat: number;
  /** Start of the window into the clip, in beats. */
  offset: number;
  /** Length of the window into the clip, in beats. */
  length: number;
}

/**
 * A clip's portable content for copy/paste (no ids). Kind-tagged so a paste can
 * refuse to cross instrument <-> audio; audio shares the source fileId (no copy).
 */
export type ClipContent =
  | { kind: "instrument"; name: string; notes: NoteEvent[]; lengthBeats: number }
  | { kind: "audio"; name: string; fileId: string; gain: number; durationSec: number };

/** A note clip (pattern) in an instrument track's pool. */
export interface NoteClipData {
  id: string;
  name: string;
  author: ClipAuthor;
  notes: NoteEvent[];
  lengthBeats: number;
}

/** Structural view of a note clip for the UI (no notes payload). */
export interface NoteClipMeta {
  id: string;
  name: string;
  author: ClipAuthor;
  lengthBeats: number;
}

/**
 * An audio clip in an audio track's pool: a reference to an OPFS-stored file. It
 * is light (no buffer), so the same shape serves as both data and structural view.
 */
export interface AudioClipData {
  id: string;
  name: string;
  author: ClipAuthor;
  /** Handle id of the audio file in the OPFS audio store. */
  fileId: string;
  /** Clip gain (0..MAX_AUDIO_GAIN; >1 boosts a quiet recording). */
  gain: number;
  /** Cached natural duration in seconds (region sizing before/without decode). */
  durationSec: number;
  /**
   * The slice of the buffer that plays, in seconds. The scheduler tiles this slice
   * across a placement, so a placement longer than the slice repeats it (looping).
   * Omitted = the whole clip (0 .. durationSec).
   */
  loopStartSec?: number;
  loopEndSec?: number;
  /**
   * Slide of the audio under the beat grid, in seconds (the clip's content offset).
   * The grid and the loop window stay fixed; this moves the buffer underneath them,
   * so a different part of the recording sits under the window and plays. Positive =
   * the audio is slid later/right (silence appears under the window's head); negative
   * = slid earlier/left (a later part of the buffer plays). Omitted = 0 (no slide).
   * See `audioPlayWindow` for how it resolves to a buffer slice.
   */
  gridOffsetSec?: number;
}

interface BaseTrackMeta {
  id: string;
  name: string;
  /** Id of the group this track lives in (always set). */
  parentId: string;
  muted: boolean;
  /** Solo: if anything is soloed, only solo-active tracks sound. */
  solo: boolean;
  /** 0..1 track output gain. */
  volume: number;
  /** Ordered insert effects between the source and the track gain. */
  effects: EffectMeta[];
}

export interface InstrumentTrackMeta extends BaseTrackMeta {
  kind: "instrument";
  instrumentType: string;
  /** The track's clip pool (note patterns). The active clip is shown in the roll. */
  clips: NoteClipMeta[];
  activeClipId: string;
  /** Arrangement: placements of clips along time. */
  placements: Placement[];
  /** Launched clip looping over the transport, overriding placements; null = arrangement. */
  launchedClipId: string | null;
}

export interface AudioTrackMeta extends BaseTrackMeta {
  kind: "audio";
  clips: AudioClipData[];
  activeClipId: string;
  placements: Placement[];
  /** Launched clip looping over the transport, overriding placements; null = arrangement. */
  launchedClipId: string | null;
}

export type TrackMeta = InstrumentTrackMeta | AudioTrackMeta;

/** An effect with its persisted param values. */
export interface EffectData extends EffectMeta {
  params: PatchValues;
}

export interface GroupData extends Omit<GroupMeta, "effects"> {
  effects: EffectData[];
}

export interface InstrumentTrackData extends Omit<
  InstrumentTrackMeta,
  "effects" | "clips" | "placements" | "activeClipId" | "launchedClipId"
> {
  /** Track-level sound (synth patch). Optional in the snapshot; defaulted on load. */
  params?: PatchValues;
  effects?: EffectData[];
  clips?: NoteClipData[];
  placements?: Placement[];
  activeClipId?: string;
  /** Launched clip id (optional; defaults to null = arrangement). */
  launchedClipId?: string | null;
}

export interface AudioTrackData extends Omit<
  AudioTrackMeta,
  "effects" | "clips" | "placements" | "activeClipId" | "launchedClipId"
> {
  effects?: EffectData[];
  clips?: AudioClipData[];
  placements?: Placement[];
  activeClipId?: string;
  /** Launched clip id (optional; defaults to null = arrangement). */
  launchedClipId?: string | null;
}

export type TrackData = InstrumentTrackData | AudioTrackData;

export interface ProjectData {
  groups: GroupData[];
  tracks: TrackData[];
  tempoBpm: number;
  lengthBeats: number;
  /** Loop start in beats (loop region is [loopStart, lengthBeats]). Optional: older snapshots default to 0. */
  loopStart?: number;
  selectedTrackId: string | null;
}
