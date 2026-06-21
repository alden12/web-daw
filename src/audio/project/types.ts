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

export interface TrackMeta {
  id: string;
  name: string;
  instrumentType: string;
  /** Id of the group this track lives in (always set). */
  parentId: string;
  muted: boolean;
  /** 0..1 track output gain. */
  volume: number;
  /** Ordered insert effects between the instrument and the track gain. */
  effects: EffectMeta[];
}

/** An effect with its persisted param values. */
export interface EffectData extends EffectMeta {
  params: PatchValues;
}

export interface GroupData extends Omit<GroupMeta, 'effects'> {
  effects: EffectData[];
}

export interface TrackData extends Omit<TrackMeta, 'effects'> {
  params: PatchValues;
  clip: ClipData;
  effects: EffectData[];
}

export interface ProjectData {
  groups: GroupData[];
  tracks: TrackData[];
  tempoBpm: number;
  lengthBeats: number;
  selectedTrackId: string | null;
}
