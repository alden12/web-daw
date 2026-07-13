/**
 * Applies an EditCommand to the ProjectStore by calling the existing store
 * mutators - one object-map entry per command type (map dispatch, per the
 * project conventions; the mapped type makes an unhandled command a compile
 * error). This is the single apply path: both the UI (via EditLog.dispatch) and
 * the MCP bridge route through it, so there is exactly one place that knows how a
 * command becomes a mutation. Behaviour is identical to the direct store calls it
 * replaces - only the entry point changes.
 */
import type { ProjectStore } from "../project/projectStore";
import type { Author, EditCommand } from "./types";

type ApplyMap = {
  [K in EditCommand["type"]]: (
    project: ProjectStore,
    command: Extract<EditCommand, { type: K }>,
    author: Author,
  ) => void;
};

const APPLY: ApplyMap = {
  createTrack: (project, command) =>
    void project.addTrack(command.instrumentType, { name: command.name, id: command.id, groupId: command.groupId }),
  createTrackFromPatch: (project, command) => void project.addTrackFromPatch(command),
  applyPatch: (project, command) =>
    project.applyPatchToTrack({
      trackId: command.trackId,
      instrumentType: command.instrumentType,
      params: command.params,
      effects: command.effects,
    }),
  createAudioTrack: (project, command) =>
    void project.addEmptyAudioTrack({ id: command.id, name: command.name, groupId: command.groupId }),
  addAudioTrack: (project, command) =>
    void project.addAudioTrack(
      {
        fileId: command.fileId,
        name: command.name,
        durationSec: command.durationSec,
        startBeat: command.startBeat,
        gain: command.gain,
      },
      { id: command.id, groupId: command.groupId },
    ),
  removeTrack: (project, command) => project.removeTrack(command.trackId),
  setTrack: (project, command) => {
    if (command.muted !== undefined) project.setMuted(command.trackId, command.muted);
    if (command.solo !== undefined) project.setSolo(command.trackId, command.solo);
    if (command.volume !== undefined) project.setVolume(command.trackId, command.volume);
    if (command.name !== undefined) project.renameTrack(command.trackId, command.name);
  },
  setInstrument: (project, command) => project.setInstrument(command.trackId, command.instrumentType),
  setAudioClip: (project, command) => project.setAudioClip(command.trackId, command.clipId, command.patch),
  addAudioClip: (project, command) => project.addAudioClip(command),
  // A recorded MIDI take: create the clip (with its notes), punch it in over the
  // lane, and place it. Tagged with the dispatching author (two-voice).
  addNoteClip: (project, command, author) => project.addNoteClip(command, author),
  createGroup: (project, command) =>
    void project.addGroup({ id: command.id, name: command.name, parentId: command.parentId }),
  removeGroup: (project, command) => project.removeGroup(command.groupId),
  setGroup: (project, command) => {
    if (command.name !== undefined) project.renameGroup(command.groupId, command.name);
    if (command.muted !== undefined) project.setGroupMuted(command.groupId, command.muted);
    if (command.solo !== undefined) project.setGroupSolo(command.groupId, command.solo);
    if (command.volume !== undefined) project.setGroupVolume(command.groupId, command.volume);
    if (command.collapsed !== undefined) project.setGroupCollapsed(command.groupId, command.collapsed);
  },
  moveTrack: (project, command) => project.moveTrack(command.trackId, command.groupId),
  moveGroup: (project, command) => project.moveGroup(command.groupId, command.parentId),
  setParam: (project, command) => {
    const track = project.getTrack(command.trackId);
    if (track?.kind === "instrument") track.params.set(command.id, command.value);
  },
  addEffect: (project, command) => void project.addEffect(command.hostId, command.effectType, command.id),
  removeEffect: (project, command) => project.removeEffect(command.hostId, command.effectId),
  moveEffect: (project, command) => project.moveEffect(command.hostId, command.effectId, command.toIndex),
  bypassEffect: (project, command) => project.setEffectBypass(command.hostId, command.effectId, command.bypassed),
  setEffectParam: (project, command) =>
    project.getEffect(command.hostId, command.effectId)?.params.set(command.id, command.value),
  // Note edits target a specific clip (defaulting to the active one). addNotes /
  // editNotes both insert-or-replace by id (putNote): a new id adds, an existing
  // id moves/resizes/re-velocities in place. One call, one edit.
  addNote: (project, command) => project.getClipStore(command.trackId, command.clipId)?.putNote(command.note),
  addNotes: (project, command) => {
    const store = project.getClipStore(command.trackId, command.clipId);
    if (store) for (const note of command.notes) store.putNote(note);
  },
  editNotes: (project, command) => {
    const store = project.getClipStore(command.trackId, command.clipId);
    if (store) for (const note of command.notes) store.putNote(note);
  },
  removeNote: (project, command) => project.getClipStore(command.trackId, command.clipId)?.removeNote(command.id),
  removeNotes: (project, command) => {
    const store = project.getClipStore(command.trackId, command.clipId);
    if (store) for (const id of command.ids) store.removeNote(id);
  },
  clearClip: (project, command) => project.getClipStore(command.trackId, command.clipId)?.clear(),
  setClipLength: (project, command) => project.setClipLength(command.trackId, command.clipId, command.lengthBeats),
  // Clip pool. The new clip is tagged with the dispatching author (two-voice).
  addClip: (project, command, author) =>
    void project.addClip(command.trackId, {
      id: command.id,
      name: command.name,
      fromClipId: command.fromClipId,
      empty: command.empty,
      lengthBeats: command.lengthBeats,
      author,
    }),
  pasteClip: (project, command, author) => project.pasteClip(command.trackId, command.id, command.content, author),
  removeClip: (project, command) => project.removeClip(command.trackId, command.clipId),
  renameClip: (project, command) => project.renameClip(command.trackId, command.clipId, command.name),
  // Arrangement placements.
  addPlacement: (project, command) =>
    void project.addPlacement(command.trackId, {
      id: command.id,
      clipId: command.clipId,
      startBeat: command.startBeat,
      offset: command.offset,
      length: command.length,
    }),
  movePlacement: (project, command) => project.movePlacement(command.trackId, command.placementId, command.startBeat),
  resizePlacement: (project, command) =>
    project.resizePlacement(command.trackId, command.placementId, { offset: command.offset, length: command.length }),
  removePlacement: (project, command) => project.removePlacement(command.trackId, command.placementId),
  splitPlacement: (project, command) =>
    project.splitPlacement(command.trackId, command.placementId, command.atBeat, command.newId),
  // Clip launching (override the arrangement with a looping clip).
  launchClip: (project, command) => project.launchClip(command.trackId, command.clipId),
  stopAllClips: (project) => project.stopAllClips(),
  setTempo: (project, command) => project.setTempo(command.bpm),
  setGroove: (project, command) => project.setGroove(command.grooveId, command.amount),
  setLength: (project, command) => project.setLength(command.lengthBeats),
  setLoopStart: (project, command) => project.setLoopStart(command.beats),
  addSample: (project, command) =>
    project.addSample({
      id: command.id,
      name: command.name,
      contentHash: command.contentHash,
      source: command.source,
    }),
  removeSample: (project, command) => project.removeSample(command.id),
};

export function applyEdit(project: ProjectStore, command: EditCommand, author: Author): void {
  (APPLY[command.type] as (project: ProjectStore, command: EditCommand, author: Author) => void)(
    project,
    command,
    author,
  );
}
