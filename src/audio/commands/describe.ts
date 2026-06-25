/**
 * Human-readable phrase for a command, for the activity feed. One entry per
 * command type (map dispatch); the mapped type keeps it exhaustive.
 */
import type { EditCommand } from './types';

type DescribeMap = { [K in EditCommand['type']]: (command: Extract<EditCommand, { type: K }>) => string };

const DESCRIBE: DescribeMap = {
  createTrack: (c) => `Added ${c.instrumentType} track`,
  addAudioTrack: (c) => `Imported ${c.name ?? 'audio'}`,
  removeTrack: () => 'Removed track',
  setTrack: (c) =>
    c.name !== undefined
      ? 'Renamed track'
      : c.muted !== undefined
        ? c.muted
          ? 'Muted track'
          : 'Unmuted track'
        : 'Set track volume',
  setAudioClip: () => 'Edited audio clip',
  createGroup: (c) => `Added group${c.name ? ` ${c.name}` : ''}`,
  removeGroup: () => 'Removed group',
  setGroup: (c) =>
    c.name !== undefined
      ? 'Renamed group'
      : c.collapsed !== undefined
        ? c.collapsed
          ? 'Collapsed group'
          : 'Expanded group'
        : c.muted !== undefined
          ? c.muted
            ? 'Muted group'
            : 'Unmuted group'
          : 'Set group volume',
  moveTrack: () => 'Moved track to group',
  moveGroup: () => 'Reparented group',
  setParam: (c) => `Set ${c.id}`,
  addEffect: (c) => `Added ${c.effectType}`,
  removeEffect: () => 'Removed effect',
  moveEffect: () => 'Reordered effect',
  bypassEffect: (c) => (c.bypassed ? 'Bypassed effect' : 'Enabled effect'),
  setEffectParam: (c) => `Set ${c.id}`,
  addNote: () => 'Added note',
  addNotes: (c) => `Added ${c.notes.length} ${c.notes.length === 1 ? 'note' : 'notes'}`,
  editNotes: (c) => `Edited ${c.notes.length} ${c.notes.length === 1 ? 'note' : 'notes'}`,
  removeNote: () => 'Removed note',
  removeNotes: (c) => `Removed ${c.ids.length} ${c.ids.length === 1 ? 'note' : 'notes'}`,
  clearClip: () => 'Cleared clip',
  addVariant: (c) => `New variant${c.name ? ` ${c.name}` : ''}`,
  selectVariant: () => 'Switched variant',
  removeVariant: () => 'Removed variant',
  renameVariant: (c) => `Renamed variant to ${c.name}`,
  setTempo: (c) => `Set tempo ${c.bpm}`,
  setLength: (c) => `Set loop length ${c.lengthBeats}`,
  setLoopStart: (c) => `Set loop start ${c.beats}`,
};

export function describeCommand(command: EditCommand): string {
  return (DESCRIBE[command.type] as (c: EditCommand) => string)(command);
}
