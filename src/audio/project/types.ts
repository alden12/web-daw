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
import type { PatchValues } from '../params/types';
import type { ClipData } from '../sequencer/types';

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
  /** 0..1 group bus output gain. */
  volume: number;
  /** Insert effects on the group bus, between its children's sum and its gain. */
  effects: EffectMeta[];
}

export type TrackKind = 'instrument' | 'audio';

/** An audio clip on an audio track: a reference to an OPFS-stored file + placement. */
export interface AudioClip {
  id: string;
  name: string;
  /** Handle id of the audio file in the OPFS audio store. */
  fileId: string;
  /** Onset within the loop, in beats. */
  startBeat: number;
  /** 0..1 clip gain. */
  gain: number;
  /** Cached natural duration in seconds (region sizing before/without decode). */
  durationSec: number;
}

interface BaseTrackMeta {
  id: string;
  name: string;
  /** Id of the group this track lives in (always set). */
  parentId: string;
  muted: boolean;
  /** 0..1 track output gain. */
  volume: number;
  /** Ordered insert effects between the source and the track gain. */
  effects: EffectMeta[];
}

export interface InstrumentTrackMeta extends BaseTrackMeta {
  kind: 'instrument';
  instrumentType: string;
}

export interface AudioTrackMeta extends BaseTrackMeta {
  kind: 'audio';
  audioClip: AudioClip;
}

export type TrackMeta = InstrumentTrackMeta | AudioTrackMeta;

/** An effect with its persisted param values. */
export interface EffectData extends EffectMeta {
  params: PatchValues;
}

export interface GroupData extends Omit<GroupMeta, 'effects'> {
  effects: EffectData[];
}

export interface InstrumentTrackData extends Omit<InstrumentTrackMeta, 'effects'> {
  params: PatchValues;
  clip: ClipData;
  effects: EffectData[];
}

export interface AudioTrackData extends Omit<AudioTrackMeta, 'effects'> {
  effects: EffectData[];
}

export type TrackData = InstrumentTrackData | AudioTrackData;

export interface ProjectData {
  groups: GroupData[];
  tracks: TrackData[];
  tempoBpm: number;
  lengthBeats: number;
  selectedTrackId: string | null;
}
