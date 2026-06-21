/**
 * The project model: the structural top of the keystone. A project is a list of
 * tracks plus transport state (tempo, loop length). Each track names an
 * instrument type and carries its own instrument params and clip.
 */
import type { PatchValues } from '../params/types';
import type { ClipData } from '../sequencer/types';

export interface TrackMeta {
  id: string;
  name: string;
  instrumentType: string;
  muted: boolean;
  /** 0..1 track output gain. */
  volume: number;
}

export interface TrackData extends TrackMeta {
  params: PatchValues;
  clip: ClipData;
}

export interface ProjectData {
  tracks: TrackData[];
  tempoBpm: number;
  lengthBeats: number;
  selectedTrackId: string | null;
}
