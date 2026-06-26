/**
 * The structural projection: the stable, store-free `ProjectStructure` view the UI
 * and MCP mirror render from. Pure read of the runtime tracks/groups into plain
 * meta (no ParamStore/ClipStore handles), so React can diff it and the view never
 * reaches into a live store. Split out of `projectStore.ts`; the store just caches
 * `buildStructure(...)` and re-runs it on every change.
 */
import type { GroupMeta, TrackMeta } from "./types";
import type { Track, Group, EffectHost, ProjectStructure } from "./projectStore";
import type { TransportState } from "./projectSerialization";

/** Effect chain as structural meta (no param values). */
function effectMetas(host: EffectHost): TrackMeta["effects"] {
  return host.effects.map((effect) => ({ id: effect.id, type: effect.type, bypassed: effect.bypassed }));
}

/** A group's structural meta. */
function groupMeta(group: Group): GroupMeta {
  return {
    id: group.id,
    name: group.name,
    parentId: group.parentId,
    collapsed: group.collapsed,
    muted: group.muted,
    solo: group.solo,
    volume: group.volume,
    effects: effectMetas(group),
  };
}

/** A track's structural meta (clip notes are summarized to a length, not carried). */
function trackMeta(track: Track): TrackMeta {
  const base = {
    id: track.id,
    name: track.name,
    parentId: track.parentId,
    muted: track.muted,
    solo: track.solo,
    volume: track.volume,
    effects: effectMetas(track),
  };
  return track.kind === "audio"
    ? {
        ...base,
        kind: "audio",
        clips: track.clips.map((clip) => ({ ...clip })),
        activeClipId: track.activeClipId,
        placements: track.placements.map((placement) => ({ ...placement })),
        launchedClipId: track.launchedClipId,
      }
    : {
        ...base,
        kind: "instrument",
        instrumentType: track.instrumentType,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          name: clip.name,
          author: clip.author,
          lengthBeats: clip.store.getClip().lengthBeats,
        })),
        activeClipId: track.activeClipId,
        placements: track.placements.map((placement) => ({ ...placement })),
        launchedClipId: track.launchedClipId,
      };
}

/** Project the runtime tracks/groups + transport into the cached structural view. */
export function buildStructure(tracks: Track[], groups: Group[], transport: TransportState): ProjectStructure {
  return {
    groups: groups.map(groupMeta),
    tracks: tracks.map(trackMeta),
    tempoBpm: transport.tempoBpm,
    lengthBeats: transport.lengthBeats,
    loopStart: transport.loopStartBeats,
    selectedTrackId: transport.selectedTrackId,
  };
}
