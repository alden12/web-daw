/**
 * Serialization for the project model: the pure transforms between the runtime
 * ProjectStore (Track/Group objects that own ParamStore/ClipStore instances) and
 * the plain `ProjectData` snapshot used for persistence, undo checkpoints, and the
 * MCP mirror. Split out of `projectStore.ts` so the store keeps the stateful CRUD
 * and these stay pure, in-one-place, and unit-testable.
 *
 * `snapshotProject` reads the runtime state into data. The `load*` builders go the
 * other way, constructing the child stores; `ProjectStore.load` drives them (it
 * still owns id-minting, effect-chain reuse, and the orphan-track repair, which
 * need the live store).
 */
import { ParamStore } from "../params/store";
import { ClipStore } from "../sequencer/clipStore";
import { effectSchema } from "../effects/catalog";
import type { PatchValues } from "../params/types";
import type {
  ProjectData,
  AudioClipData,
  Placement,
  ClipAuthor,
  EffectData,
  InstrumentTrackData,
  AudioTrackData,
} from "./types";
import type { Track, Group, NoteClip, EffectInstance, EffectHost } from "./projectStore";
import type { SampleAsset } from "../samples/catalog";

/** Serialize an effect chain (its params snapshotted) for persistence. */
function snapshotEffects(host: EffectHost): EffectData[] {
  return host.effects.map((effect) => ({
    id: effect.id,
    type: effect.type,
    bypassed: effect.bypassed,
    params: effect.params.snapshot(),
  }));
}

/** The transport + selection fields a snapshot carries alongside the buses/tracks. */
export interface TransportState {
  tempoBpm: number;
  lengthBeats: number;
  loopStartBeats: number;
  selectedTrackId: string | null;
  grooveId: string;
  grooveAmount: number;
  samples: SampleAsset[];
}

/** Read the whole runtime project into a plain, serializable `ProjectData`. */
export function snapshotProject(tracks: Track[], groups: Group[], transport: TransportState): ProjectData {
  return {
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      parentId: group.parentId,
      collapsed: group.collapsed,
      muted: group.muted,
      solo: group.solo,
      volume: group.volume,
      effects: snapshotEffects(group),
    })),
    tracks: tracks.map((track) => {
      const base = {
        id: track.id,
        name: track.name,
        parentId: track.parentId,
        muted: track.muted,
        solo: track.solo,
        volume: track.volume,
      };
      const arrangement = {
        activeClipId: track.activeClipId,
        placements: track.placements.map((placement) => ({ ...placement })),
        launchedClipId: track.launchedClipId,
      };
      if (track.kind === "audio") {
        return {
          ...base,
          kind: "audio" as const,
          effects: snapshotEffects(track),
          clips: track.clips.map((clip) => ({ ...clip })),
          ...arrangement,
        };
      }
      return {
        ...base,
        kind: "instrument" as const,
        instrumentType: track.instrumentType,
        params: track.params.snapshot(),
        effects: snapshotEffects(track),
        clips: track.clips.map((clip) => {
          const data = clip.store.snapshot();
          return {
            id: clip.id,
            name: clip.name,
            author: clip.author,
            notes: data.notes.map((note) => ({ ...note })),
            lengthBeats: data.lengthBeats,
          };
        }),
        ...arrangement,
      };
    }),
    tempoBpm: transport.tempoBpm,
    lengthBeats: transport.lengthBeats,
    loopStart: transport.loopStartBeats,
    selectedTrackId: transport.selectedTrackId,
    grooveId: transport.grooveId,
    grooveAmount: transport.grooveAmount,
    samples: transport.samples.map((sample) => ({ ...sample })),
  };
}

/** Build fresh effect instances (each with its own ParamStore) from stored effects. */
export function loadEffectInstances(effects: ProjectData["tracks"][number]["effects"] = []): EffectInstance[] {
  return effects.map((effect) => {
    const store = new ParamStore(effectSchema(effect.type));
    if (effect.params) store.load(effect.params);
    return { id: effect.id, type: effect.type, bypassed: effect.bypassed ?? false, params: store };
  });
}

/** Normalize a stored author tag (defaults to the local user). */
export function clipAuthor(author: unknown): ClipAuthor {
  return author === "claude" ? "claude" : "you";
}

/** Id minters the clip-pool builder needs for its empty-clip / default-placement fallbacks. */
export interface PoolIds {
  clipId: () => string;
  placementId: () => string;
}

/**
 * The note-clip pool + active id + placements for an instrument track from its
 * stored `clips`/`activeClipId`/`placements`. A pool with no clips falls back to a
 * single empty clip "A" so the track always has something to edit.
 */
export function noteClipPool(
  track: InstrumentTrackData,
  projLen: number,
  ids: PoolIds,
): { clips: NoteClip[]; activeClipId: string; placements: Placement[] } {
  const make = (
    id: string,
    name: string,
    author: ClipAuthor,
    clip: { notes?: unknown; lengthBeats?: number },
  ): NoteClip => ({
    id,
    name,
    author,
    store: new ClipStore({ notes: (clip.notes as never) ?? [], lengthBeats: clip.lengthBeats ?? projLen }),
  });

  const clips: NoteClip[] = track.clips?.length
    ? track.clips.map((clip) => make(clip.id, clip.name, clipAuthor(clip.author), clip))
    : [make(ids.clipId(), "A", "you", {})];

  const activeClipId =
    track.activeClipId && clips.some((clip) => clip.id === track.activeClipId) ? track.activeClipId : clips[0].id;
  const placements: Placement[] = track.placements?.length
    ? track.placements.map((placement) => ({ ...placement }))
    : [
        {
          id: ids.placementId(),
          clipId: activeClipId,
          startBeat: 0,
          offset: 0,
          length: clips.find((clip) => clip.id === activeClipId)!.store.getClip().lengthBeats,
        },
      ];
  return { clips, activeClipId, placements };
}

/** The track-level sound (params + effect chain) for an instrument track. */
export function instrumentSound(track: InstrumentTrackData): { params: PatchValues; effects: EffectData[] } {
  return { params: track.params ?? {}, effects: track.effects ?? [] };
}

/** The audio-clip pool + active id + placements for an audio track. */
export function audioClipPool(track: AudioTrackData): {
  clips: AudioClipData[];
  activeClipId: string;
  placements: Placement[];
} {
  const clips = (track.clips ?? []).map((clip) => ({ ...clip }));
  const activeClipId =
    track.activeClipId && clips.some((clip) => clip.id === track.activeClipId)
      ? track.activeClipId
      : (clips[0]?.id ?? "");
  return { clips, activeClipId, placements: (track.placements ?? []).map((placement) => ({ ...placement })) };
}
