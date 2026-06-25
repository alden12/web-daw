/**
 * Human-readable phrase for a command, for the activity feed. One entry per
 * command type (map dispatch); the mapped type keeps it exhaustive.
 *
 * An optional `DescribeContext` resolves an id to its current display name so the
 * feed can say "Added Tremolo to Demo Organ" rather than "Added effect". It is
 * optional so the function stays pure for history auto-messages and tests; when
 * absent (or a name no longer resolves) the phrasing degrades to the type alone.
 */
import type { EditCommand } from './types';
import { catalogEntry, hasInstrument } from '../instruments/catalog';
import { effectCatalogEntry, hasEffect } from '../effects/catalog';

/** Resolves a track/group/effect-host id to its current name (for richer labels). */
export interface DescribeContext {
  name(id: string): string | undefined;
}

const instLabel = (type: string): string => (hasInstrument(type) ? catalogEntry(type).label : type);
const fxLabel = (type: string): string => (hasEffect(type) ? effectCatalogEntry(type).label : type);

/** ` <prep> Name` (or just ` Name` when prep is '') if the id resolves, else ''. */
function on(ctx: DescribeContext | undefined, id: string | undefined, prep = 'on'): string {
  const name = id ? ctx?.name(id) : undefined;
  if (!name) return '';
  return prep ? ` ${prep} ${name}` : ` ${name}`;
}

const plural = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;

type DescribeMap = {
  [K in EditCommand['type']]: (command: Extract<EditCommand, { type: K }>, ctx?: DescribeContext) => string;
};

const DESCRIBE: DescribeMap = {
  createTrack: (c, ctx) => `Added ${instLabel(c.instrumentType)} track${on(ctx, c.id, '')}`,
  addAudioTrack: (c) => `Imported ${c.name ?? 'audio'}`,
  removeTrack: () => 'Removed track',
  setTrack: (c, ctx) => {
    const name = on(ctx, c.trackId, '');
    if (c.name !== undefined) return `Renamed track to ${c.name}`;
    if (c.muted !== undefined) return `${c.muted ? 'Muted' : 'Unmuted'} track${name}`;
    if (c.solo !== undefined) return `${c.solo ? 'Soloed' : 'Unsoloed'} track${name}`;
    return `Set volume${name}`;
  },
  setAudioClip: () => 'Edited audio clip',
  createGroup: (c) => `Added group${c.name ? ` ${c.name}` : ''}`,
  removeGroup: () => 'Removed group',
  setGroup: (c, ctx) => {
    const name = on(ctx, c.groupId, '');
    if (c.name !== undefined) return `Renamed group to ${c.name}`;
    if (c.collapsed !== undefined) return `${c.collapsed ? 'Collapsed' : 'Expanded'} group${name}`;
    if (c.muted !== undefined) return `${c.muted ? 'Muted' : 'Unmuted'} group${name}`;
    if (c.solo !== undefined) return `${c.solo ? 'Soloed' : 'Unsoloed'} group${name}`;
    return `Set group volume${name}`;
  },
  moveTrack: () => 'Moved track to group',
  moveGroup: () => 'Reparented group',
  setParam: (c, ctx) => `Set ${c.id}${on(ctx, c.trackId)}`,
  addEffect: (c, ctx) => `Added ${fxLabel(c.effectType)}${on(ctx, c.hostId, 'to')}`,
  removeEffect: (c, ctx) => `Removed effect${on(ctx, c.hostId, 'from')}`,
  moveEffect: () => 'Reordered effect',
  bypassEffect: (c, ctx) => `${c.bypassed ? 'Bypassed' : 'Enabled'} effect${on(ctx, c.hostId)}`,
  setEffectParam: (c, ctx) => `Set ${c.id}${on(ctx, c.hostId)}`,
  addNote: (c, ctx) => `Added note${on(ctx, c.trackId, 'to')}`,
  addNotes: (c, ctx) => `Added ${plural(c.notes.length)}${on(ctx, c.trackId, 'to')}`,
  editNotes: (c, ctx) => `Edited ${plural(c.notes.length)}${on(ctx, c.trackId)}`,
  removeNote: (c, ctx) => `Removed note${on(ctx, c.trackId, 'from')}`,
  removeNotes: (c, ctx) => `Removed ${plural(c.ids.length)}${on(ctx, c.trackId, 'from')}`,
  clearClip: (c, ctx) => `Cleared clip${on(ctx, c.trackId)}`,
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

export function describeCommand(command: EditCommand, ctx?: DescribeContext): string {
  // A persisted/restored log can contain command types from an older app version
  // (e.g. pre-rename `addVariant`); describe them by their raw type rather than
  // crashing the feed.
  const fn = DESCRIBE[command.type] as ((c: EditCommand, ctx?: DescribeContext) => string) | undefined;
  return fn ? fn(command, ctx) : command.type;
}
