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
        : c.solo !== undefined
          ? c.solo
            ? 'Soloed track'
            : 'Unsoloed track'
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
          : c.solo !== undefined
            ? c.solo
              ? 'Soloed group'
              : 'Unsoloed group'
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
  setClipLength: (c) => `Set clip length ${c.lengthBeats}`,
  addClip: (c) => `New clip${c.name ? ` ${c.name}` : ''}`,
  removeClip: () => 'Removed clip',
  renameClip: (c) => `Renamed clip to ${c.name}`,
  pasteClip: (c) => `Pasted clip ${c.content.name}`,
  addPlacement: () => 'Placed clip',
  movePlacement: () => 'Moved clip',
  resizePlacement: () => 'Resized clip',
  removePlacement: () => 'Removed clip from arrangement',
  splitPlacement: () => 'Split clip',
  launchClip: (c) => (c.clipId ? 'Launched clip' : 'Stopped clip'),
  stopAllClips: () => 'Back to timeline',
  setTempo: (c) => `Set tempo ${c.bpm}`,
  setLength: (c) => `Set loop length ${c.lengthBeats}`,
  setLoopStart: (c) => `Set loop start ${c.beats}`,
};

export function describeCommand(command: EditCommand): string {
  // A persisted/restored log can contain command types from an older app version
  // (e.g. pre-rename `addVariant`); describe them by their raw type rather than
  // crashing the feed.
  const fn = DESCRIBE[command.type] as ((c: EditCommand) => string) | undefined;
  return fn ? fn(command) : command.type;
}
