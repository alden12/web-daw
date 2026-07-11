/**
 * Maps an edit command to the object keys it authored, so the applyEdit seam can stamp
 * "who last edited this" into the project's `authorship` map (see ProjectData.authorship and
 * the last-editor colour tint). One object-map entry per command type (map dispatch, per the
 * project conventions), mirroring applyEdit's shape: `touched` keys are stamped with the
 * dispatching author, `removed` keys (exact, or a `prefix:` that clears everything under it)
 * are forgotten so a deleted object's authorship does not linger.
 *
 * The key builders are exported so the UI reads authorship with the same keys this writes -
 * one spelling of `track:<id>` / `note:<id>` / `param:<trackId>:<id>`, never a duplicated string.
 */
import type { EditCommand } from "./types";

export const trackKey = (id: string): string => `track:${id}`;
export const noteKey = (id: string): string => `note:${id}`;
export const paramKey = (trackId: string, id: string): string => `param:${trackId}:${id}`;
export const effectKey = (id: string): string => `effect:${id}`;
export const effectParamKey = (hostId: string, effectId: string, id: string): string =>
  `effectParam:${hostId}:${effectId}:${id}`;
export const midiDeviceKey = (id: string): string => `midiDevice:${id}`;
export const midiDeviceParamKey = (trackId: string, deviceId: string, id: string): string =>
  `midiDeviceParam:${trackId}:${deviceId}:${id}`;
export const clipKey = (id: string): string => `clip:${id}`;
export const placementKey = (id: string): string => `placement:${id}`;
export const groupKey = (id: string): string => `group:${id}`;

/** What a command authored: keys to stamp (`touched`) and keys to forget (`removed`). */
export interface AuthorshipEffect {
  touched?: string[];
  removed?: string[];
}

type EffectMap = {
  [K in EditCommand["type"]]?: (command: Extract<EditCommand, { type: K }>) => AuthorshipEffect;
};

// Most commands stamp their track plus a finer key (the note / param / effect they touched), so
// a track row shows its last editor and each element shows its own. Project-level commands (tempo,
// groove, length, sample library) tint no object, so they are simply absent from the map.
const EFFECTS: EffectMap = {
  createTrack: (command) => ({ touched: [trackKey(command.id)] }),
  createTrackFromPatch: (command) => ({
    touched: [trackKey(command.id), ...command.effects.map((effect) => effectKey(effect.id))],
  }),
  applyPatch: (command) => ({
    // A patch replaces the instrument + params + chain, so old per-param authorship is stale.
    touched: [trackKey(command.trackId), ...command.effects.map((effect) => effectKey(effect.id))],
    removed: [`param:${command.trackId}:`],
  }),
  createAudioTrack: (command) => ({ touched: [trackKey(command.id)] }),
  addAudioTrack: (command) => ({ touched: [trackKey(command.id)] }),
  removeTrack: (command) => ({
    removed: [trackKey(command.trackId), `param:${command.trackId}:`, `effectParam:${command.trackId}:`],
  }),
  setTrack: (command) => ({ touched: [trackKey(command.trackId)] }),
  setInstrument: (command) => ({ touched: [trackKey(command.trackId)], removed: [`param:${command.trackId}:`] }),
  setAudioClip: (command) => ({ touched: [trackKey(command.trackId)] }),
  addAudioClip: (command) => ({
    touched: [trackKey(command.trackId), clipKey(command.id), placementKey(command.placementId)],
  }),
  addNoteClip: (command) => ({
    touched: [
      trackKey(command.trackId),
      clipKey(command.id),
      placementKey(command.placementId),
      ...command.notes.map((note) => noteKey(note.id)),
    ],
  }),
  createGroup: (command) => ({ touched: [groupKey(command.id)] }),
  removeGroup: (command) => ({ removed: [groupKey(command.groupId)] }),
  setGroup: (command) => ({ touched: [groupKey(command.groupId)] }),
  moveTrack: (command) => ({ touched: [trackKey(command.trackId)] }),
  moveGroup: (command) => ({ touched: [groupKey(command.groupId)] }),
  setParam: (command) => ({ touched: [trackKey(command.trackId), paramKey(command.trackId, command.id)] }),
  addEffect: (command) => ({ touched: [trackKey(command.hostId), effectKey(command.id)] }),
  removeEffect: (command) => ({
    touched: [trackKey(command.hostId)],
    removed: [effectKey(command.effectId), `effectParam:${command.hostId}:${command.effectId}:`],
  }),
  moveEffect: (command) => ({ touched: [trackKey(command.hostId), effectKey(command.effectId)] }),
  bypassEffect: (command) => ({ touched: [trackKey(command.hostId), effectKey(command.effectId)] }),
  setEffectParam: (command) => ({
    touched: [
      trackKey(command.hostId),
      effectKey(command.effectId),
      effectParamKey(command.hostId, command.effectId, command.id),
    ],
  }),
  addMidiDevice: (command) => ({ touched: [trackKey(command.trackId), midiDeviceKey(command.id)] }),
  removeMidiDevice: (command) => ({
    touched: [trackKey(command.trackId)],
    removed: [midiDeviceKey(command.deviceId), `midiDeviceParam:${command.trackId}:${command.deviceId}:`],
  }),
  moveMidiDevice: (command) => ({ touched: [trackKey(command.trackId), midiDeviceKey(command.deviceId)] }),
  bypassMidiDevice: (command) => ({ touched: [trackKey(command.trackId), midiDeviceKey(command.deviceId)] }),
  setMidiDeviceParam: (command) => ({
    touched: [
      trackKey(command.trackId),
      midiDeviceKey(command.deviceId),
      midiDeviceParamKey(command.trackId, command.deviceId, command.id),
    ],
  }),
  addNote: (command) => ({ touched: [trackKey(command.trackId), noteKey(command.note.id)] }),
  addNotes: (command) => ({ touched: [trackKey(command.trackId), ...command.notes.map((note) => noteKey(note.id))] }),
  editNotes: (command) => ({ touched: [trackKey(command.trackId), ...command.notes.map((note) => noteKey(note.id))] }),
  removeNote: (command) => ({ touched: [trackKey(command.trackId)], removed: [noteKey(command.id)] }),
  removeNotes: (command) => ({ touched: [trackKey(command.trackId)], removed: command.ids.map((id) => noteKey(id)) }),
  clearClip: (command) => ({ touched: [trackKey(command.trackId)] }),
  setClipLength: (command) => ({
    touched: [trackKey(command.trackId), ...(command.clipId ? [clipKey(command.clipId)] : [])],
  }),
  addClip: (command) => ({ touched: [trackKey(command.trackId), clipKey(command.id)] }),
  pasteClip: (command) => ({ touched: [trackKey(command.trackId), clipKey(command.id)] }),
  removeClip: (command) => ({ touched: [trackKey(command.trackId)], removed: [clipKey(command.clipId)] }),
  renameClip: (command) => ({ touched: [trackKey(command.trackId), clipKey(command.clipId)] }),
  addPlacement: (command) => ({ touched: [trackKey(command.trackId), placementKey(command.id)] }),
  movePlacement: (command) => ({ touched: [trackKey(command.trackId), placementKey(command.placementId)] }),
  resizePlacement: (command) => ({ touched: [trackKey(command.trackId), placementKey(command.placementId)] }),
  removePlacement: (command) => ({
    touched: [trackKey(command.trackId)],
    removed: [placementKey(command.placementId)],
  }),
  splitPlacement: (command) => ({
    touched: [trackKey(command.trackId), placementKey(command.placementId), placementKey(command.newId)],
  }),
};

/** The authorship effect of a command (empty for project-level commands that tint no object). */
export function authorshipEffect(command: EditCommand): AuthorshipEffect {
  const builder = EFFECTS[command.type] as ((command: EditCommand) => AuthorshipEffect) | undefined;
  return builder ? builder(command) : {};
}

// Note edits carry no clip id when they target the track's active clip, so the pure mapper above
// can't name the clip they touched. applyEdit resolves the active clip and stamps `clip:<id>` too,
// so a clip's authorship - and thus its timeline block colour - follows note edits, not just
// clip-level ops (create / rename / length).
const NOTE_EDIT_TYPES = new Set<EditCommand["type"]>([
  "addNote",
  "addNotes",
  "editNotes",
  "removeNote",
  "removeNotes",
  "clearClip",
]);

/** For a note-editing command, the track + (optional) clip it targets; null for any other command. */
export function noteEditClipTarget(command: EditCommand): { trackId: string; clipId?: string } | null {
  if (!NOTE_EDIT_TYPES.has(command.type)) return null;
  const scoped = command as Extract<EditCommand, { trackId: string }> & { clipId?: string };
  return { trackId: scoped.trackId, clipId: scoped.clipId };
}
