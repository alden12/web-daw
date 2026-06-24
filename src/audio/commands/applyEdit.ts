/**
 * Applies an EditCommand to the ProjectStore by calling the existing store
 * mutators - one object-map entry per command type (map dispatch, per the
 * project conventions; the mapped type makes an unhandled command a compile
 * error). This is the single apply path: both the UI (via EditLog.dispatch) and
 * the MCP bridge route through it, so there is exactly one place that knows how a
 * command becomes a mutation. Behaviour is identical to the direct store calls it
 * replaces - only the entry point changes.
 */
import type { ProjectStore } from '../project/projectStore';
import type { Author, EditCommand } from './types';

type ApplyMap = {
  [K in EditCommand['type']]: (
    project: ProjectStore,
    command: Extract<EditCommand, { type: K }>,
    author: Author,
  ) => void;
};

const APPLY: ApplyMap = {
  createTrack: (p, c) => void p.addTrack(c.instrumentType, { name: c.name, id: c.id, groupId: c.groupId }),
  createTrackFromPatch: (p, c) => void p.addTrackFromPatch(c),
  addAudioTrack: (p, c) =>
    void p.addAudioTrack(
      { fileId: c.fileId, name: c.name, durationSec: c.durationSec, startBeat: c.startBeat, gain: c.gain },
      { id: c.id, groupId: c.groupId },
    ),
  removeTrack: (p, c) => p.removeTrack(c.trackId),
  setTrack: (p, c) => {
    if (c.muted !== undefined) p.setMuted(c.trackId, c.muted);
    if (c.solo !== undefined) p.setSolo(c.trackId, c.solo);
    if (c.volume !== undefined) p.setVolume(c.trackId, c.volume);
    if (c.name !== undefined) p.renameTrack(c.trackId, c.name);
  },
  setAudioClip: (p, c) => p.setAudioClip(c.trackId, c.clipId, c.patch),
  createGroup: (p, c) => void p.addGroup({ id: c.id, name: c.name, parentId: c.parentId }),
  removeGroup: (p, c) => p.removeGroup(c.groupId),
  setGroup: (p, c) => {
    if (c.name !== undefined) p.renameGroup(c.groupId, c.name);
    if (c.muted !== undefined) p.setGroupMuted(c.groupId, c.muted);
    if (c.solo !== undefined) p.setGroupSolo(c.groupId, c.solo);
    if (c.volume !== undefined) p.setGroupVolume(c.groupId, c.volume);
    if (c.collapsed !== undefined) p.setGroupCollapsed(c.groupId, c.collapsed);
  },
  moveTrack: (p, c) => p.moveTrack(c.trackId, c.groupId),
  moveGroup: (p, c) => p.moveGroup(c.groupId, c.parentId),
  setParam: (p, c) => {
    const t = p.getTrack(c.trackId);
    if (t?.kind === 'instrument') t.params.set(c.id, c.value);
  },
  addEffect: (p, c) => void p.addEffect(c.hostId, c.effectType, c.id),
  removeEffect: (p, c) => p.removeEffect(c.hostId, c.effectId),
  moveEffect: (p, c) => p.moveEffect(c.hostId, c.effectId, c.toIndex),
  bypassEffect: (p, c) => p.setEffectBypass(c.hostId, c.effectId, c.bypassed),
  setEffectParam: (p, c) => p.getEffect(c.hostId, c.effectId)?.params.set(c.id, c.value),
  // Note edits target a specific clip (defaulting to the active one). addNotes /
  // editNotes both insert-or-replace by id (putNote): a new id adds, an existing
  // id moves/resizes/re-velocities in place. One call, one edit.
  addNote: (p, c) => p.getClipStore(c.trackId, c.clipId)?.putNote(c.note),
  addNotes: (p, c) => {
    const store = p.getClipStore(c.trackId, c.clipId);
    if (store) for (const n of c.notes) store.putNote(n);
  },
  editNotes: (p, c) => {
    const store = p.getClipStore(c.trackId, c.clipId);
    if (store) for (const n of c.notes) store.putNote(n);
  },
  removeNote: (p, c) => p.getClipStore(c.trackId, c.clipId)?.removeNote(c.id),
  removeNotes: (p, c) => {
    const store = p.getClipStore(c.trackId, c.clipId);
    if (store) for (const id of c.ids) store.removeNote(id);
  },
  clearClip: (p, c) => p.getClipStore(c.trackId, c.clipId)?.clear(),
  setClipLength: (p, c) => p.setClipLength(c.trackId, c.clipId, c.lengthBeats),
  // Clip pool. The new clip is tagged with the dispatching author (two-voice).
  addClip: (p, c, author) =>
    void p.addClip(c.trackId, { id: c.id, name: c.name, fromClipId: c.fromClipId, empty: c.empty, lengthBeats: c.lengthBeats, author }),
  pasteClip: (p, c, author) => p.pasteClip(c.trackId, c.id, c.content, author),
  removeClip: (p, c) => p.removeClip(c.trackId, c.clipId),
  renameClip: (p, c) => p.renameClip(c.trackId, c.clipId, c.name),
  // Arrangement placements.
  addPlacement: (p, c) =>
    void p.addPlacement(c.trackId, { id: c.id, clipId: c.clipId, startBeat: c.startBeat, offset: c.offset, length: c.length }),
  movePlacement: (p, c) => p.movePlacement(c.trackId, c.placementId, c.startBeat),
  resizePlacement: (p, c) => p.resizePlacement(c.trackId, c.placementId, { offset: c.offset, length: c.length }),
  removePlacement: (p, c) => p.removePlacement(c.trackId, c.placementId),
  splitPlacement: (p, c) => p.splitPlacement(c.trackId, c.placementId, c.atBeat, c.newId),
  // Clip launching (override the arrangement with a looping clip).
  launchClip: (p, c) => p.launchClip(c.trackId, c.clipId),
  stopAllClips: (p) => p.stopAllClips(),
  setTempo: (p, c) => p.setTempo(c.bpm),
  setLength: (p, c) => p.setLength(c.lengthBeats),
  setLoopStart: (p, c) => p.setLoopStart(c.beats),
};

export function applyEdit(project: ProjectStore, command: EditCommand, author: Author): void {
  (APPLY[command.type] as (p: ProjectStore, c: EditCommand, author: Author) => void)(project, command, author);
}
