/**
 * The project model: the structural top of the keystone. A project is a list of
 * tracks plus transport state (tempo, loop length). Each track names an
 * instrument type and carries its own instrument params and clip.
 */
import type { PatchValues } from '../params/types';
import type { ClipData } from '../sequencer/types';

/** An effect in a track's chain (structural view, no param values). */
export interface EffectMeta {
  id: string;
  type: string;
  bypassed: boolean;
}

export interface TrackMeta {
  id: string;
  name: string;
  instrumentType: string;
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

export interface TrackData extends Omit<TrackMeta, 'effects'> {
  params: PatchValues;
  clip: ClipData;
  effects: EffectData[];
}

export interface ProjectData {
  tracks: TrackData[];
  tempoBpm: number;
  lengthBeats: number;
  selectedTrackId: string | null;
}
