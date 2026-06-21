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
  addAudioTrack: (p, c) =>
    void p.addAudioTrack(
      { fileId: c.fileId, name: c.name, durationSec: c.durationSec, startBeat: c.startBeat, gain: c.gain },
      { id: c.id, groupId: c.groupId },
    ),
  removeTrack: (p, c) => p.removeTrack(c.trackId),
  setTrack: (p, c) => {
    if (c.muted !== undefined) p.setMuted(c.trackId, c.muted);
    if (c.volume !== undefined) p.setVolume(c.trackId, c.volume);
    if (c.name !== undefined) p.renameTrack(c.trackId, c.name);
  },
  setAudioClip: (p, c) => p.setAudioClip(c.trackId, c.patch),
  createGroup: (p, c) => void p.addGroup({ id: c.id, name: c.name, parentId: c.parentId }),
  removeGroup: (p, c) => p.removeGroup(c.groupId),
  setGroup: (p, c) => {
    if (c.name !== undefined) p.renameGroup(c.groupId, c.name);
    if (c.muted !== undefined) p.setGroupMuted(c.groupId, c.muted);
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
  addNote: (p, c) => {
    const t = p.getTrack(c.trackId);
    if (t?.kind === 'instrument') t.clip.putNote(c.note);
  },
  removeNote: (p, c) => {
    const t = p.getTrack(c.trackId);
    if (t?.kind === 'instrument') t.clip.removeNote(c.id);
  },
  clearClip: (p, c) => {
    const t = p.getTrack(c.trackId);
    if (t?.kind === 'instrument') t.clip.clear();
  },
  // The new variant is tagged with the dispatching author (two-voice: you/claude).
  addVariant: (p, c, author) =>
    void p.addVariant(c.trackId, { id: c.id, name: c.name, fromVariantId: c.fromVariantId, author }),
  selectVariant: (p, c) => p.selectVariant(c.trackId, c.variantId),
  removeVariant: (p, c) => p.removeVariant(c.trackId, c.variantId),
  renameVariant: (p, c) => p.renameVariant(c.trackId, c.variantId, c.name),
  setTempo: (p, c) => p.setTempo(c.bpm),
};

export function applyEdit(project: ProjectStore, command: EditCommand, author: Author): void {
  (APPLY[command.type] as (p: ProjectStore, c: EditCommand, author: Author) => void)(project, command, author);
}
