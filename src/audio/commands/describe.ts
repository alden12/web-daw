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
  removeNote: () => 'Removed note',
  clearClip: () => 'Cleared clip',
  setTempo: (c) => `Set tempo ${c.bpm}`,
};

export function describeCommand(command: EditCommand): string {
  return (DESCRIBE[command.type] as (c: EditCommand) => string)(command);
}
