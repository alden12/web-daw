/**
 * Human-readable phrase for a command, for the activity feed. One entry per
 * command type (map dispatch); the mapped type keeps it exhaustive.
 *
 * An optional `DescribeContext` resolves an id to its current display name so the
 * feed can say "Added Tremolo to Demo Organ" rather than "Added effect". It is
 * optional so the function stays pure for history auto-messages and tests; when
 * absent (or a name no longer resolves) the phrasing degrades to the type alone.
 */
import type { EditCommand } from "./types";
import { catalogEntry, hasInstrument } from "../instruments/catalog";
import { effectCatalogEntry, hasEffect } from "../effects/catalog";
import { midiDeviceCatalogEntry, hasMidiDevice } from "../midi/device/catalog";
import { grooveById } from "../grooves/catalog";

/** Resolves a track/group/effect-host id to its current name (for richer labels). */
export interface DescribeContext {
  name(id: string): string | undefined;
}

const instLabel = (type: string): string => (hasInstrument(type) ? catalogEntry(type).label : type);
const fxLabel = (type: string): string => (hasEffect(type) ? effectCatalogEntry(type).label : type);
const mdLabel = (type: string): string => (hasMidiDevice(type) ? midiDeviceCatalogEntry(type).label : type);

/** ` <prep> Name` (or just ` Name` when prep is '') if the id resolves, else ''. */
function on(ctx: DescribeContext | undefined, id: string | undefined, prep = "on"): string {
  const name = id ? ctx?.name(id) : undefined;
  if (!name) return "";
  return prep ? ` ${prep} ${name}` : ` ${name}`;
}

const plural = (count: number) => `${count} ${count === 1 ? "note" : "notes"}`;

type DescribeMap = {
  [K in EditCommand["type"]]: (command: Extract<EditCommand, { type: K }>, ctx?: DescribeContext) => string;
};

const DESCRIBE: DescribeMap = {
  createTrack: (command, ctx) => `Added ${instLabel(command.instrumentType)} track${on(ctx, command.id, "")}`,
  createTrackFromPatch: (command) => `Added ${command.name ? `"${command.name}"` : "a patch"} from the library`,
  applyPatch: (command, ctx) => `Applied ${command.name ? `"${command.name}"` : "patch"}${on(ctx, command.trackId)}`,
  createAudioTrack: (command, ctx) => `Added audio track${on(ctx, command.id, "")}`,
  addAudioTrack: (command) => `Imported ${command.name ?? "audio"}`,
  renameProject: (command) => `Renamed project to "${command.name}"`,
  commit: (command) => `Saved version: ${command.message}`,
  removeTrack: () => "Removed track",
  setTrack: (command, ctx) => {
    const name = on(ctx, command.trackId, "");
    if (command.name !== undefined) return `Renamed track to ${command.name}`;
    if (command.muted !== undefined) return `${command.muted ? "Muted" : "Unmuted"} track${name}`;
    if (command.solo !== undefined) return `${command.solo ? "Soloed" : "Unsoloed"} track${name}`;
    return `Set volume${name}`;
  },
  setInstrument: (command, ctx) =>
    `Set instrument to ${instLabel(command.instrumentType)}${on(ctx, command.trackId, "")}`,
  addCustomInstrument: (command) => `Added instrument "${command.def.label ?? command.def.type}"`,
  removeCustomInstrument: () => "Removed a custom instrument",
  addCustomEffect: (command) => `Added effect "${command.def.label ?? command.def.type}"`,
  removeCustomEffect: () => "Removed a custom effect",
  setAudioClip: () => "Edited audio clip",
  addAudioClip: (command) => `Recorded ${command.name ? `"${command.name}"` : "a take"}`,
  addNoteClip: (command) =>
    `Recorded ${command.name ? `"${command.name}"` : "a take"} (${plural(command.notes.length)})`,
  createGroup: (command) => `Added group${command.name ? ` ${command.name}` : ""}`,
  removeGroup: () => "Removed group",
  setGroup: (command, ctx) => {
    const name = on(ctx, command.groupId, "");
    if (command.name !== undefined) return `Renamed group to ${command.name}`;
    if (command.collapsed !== undefined) return `${command.collapsed ? "Collapsed" : "Expanded"} group${name}`;
    if (command.muted !== undefined) return `${command.muted ? "Muted" : "Unmuted"} group${name}`;
    if (command.solo !== undefined) return `${command.solo ? "Soloed" : "Unsoloed"} group${name}`;
    return `Set group volume${name}`;
  },
  moveTrack: () => "Moved track to group",
  moveGroup: () => "Reparented group",
  setParam: (command, ctx) => `Set ${command.id}${on(ctx, command.trackId)}`,
  addEffect: (command, ctx) => `Added ${fxLabel(command.effectType)}${on(ctx, command.hostId, "to")}`,
  removeEffect: (command, ctx) => `Removed effect${on(ctx, command.hostId, "from")}`,
  moveEffect: () => "Reordered effect",
  bypassEffect: (command, ctx) => `${command.bypassed ? "Bypassed" : "Enabled"} effect${on(ctx, command.hostId)}`,
  setEffectParam: (command, ctx) => `Set ${command.id}${on(ctx, command.hostId)}`,
  addMidiDevice: (command, ctx) => `Added ${mdLabel(command.deviceType)}${on(ctx, command.trackId, "to")}`,
  removeMidiDevice: (command, ctx) => `Removed MIDI device${on(ctx, command.trackId, "from")}`,
  moveMidiDevice: () => "Reordered MIDI device",
  bypassMidiDevice: (command, ctx) =>
    `${command.bypassed ? "Bypassed" : "Enabled"} MIDI device${on(ctx, command.trackId)}`,
  setMidiDeviceParam: (command, ctx) => `Set ${command.id}${on(ctx, command.trackId)}`,
  addNote: (command, ctx) => `Added note${on(ctx, command.trackId, "to")}`,
  addNotes: (command, ctx) => `Added ${plural(command.notes.length)}${on(ctx, command.trackId, "to")}`,
  editNotes: (command, ctx) => `Edited ${plural(command.notes.length)}${on(ctx, command.trackId)}`,
  removeNote: (command, ctx) => `Removed note${on(ctx, command.trackId, "from")}`,
  removeNotes: (command, ctx) => `Removed ${plural(command.ids.length)}${on(ctx, command.trackId, "from")}`,
  clearClip: (command, ctx) => `Cleared clip${on(ctx, command.trackId)}`,
  setClipLength: (command) => `Set clip length ${command.lengthBeats}`,
  addClip: (command) => `New clip${command.name ? ` ${command.name}` : ""}`,
  removeClip: () => "Removed clip",
  renameClip: (command) => `Renamed clip to ${command.name}`,
  pasteClip: (command) => `Pasted clip ${command.content.name}`,
  addPlacement: () => "Placed clip",
  movePlacement: () => "Moved clip",
  resizePlacement: () => "Resized clip",
  removePlacement: () => "Removed clip from arrangement",
  splitPlacement: () => "Split clip",
  launchClip: (command) => (command.clipId ? "Launched clip" : "Stopped clip"),
  stopAllClips: () => "Back to timeline",
  setTempo: (command) => `Set tempo ${command.bpm}`,
  setGroove: (command) =>
    command.grooveId !== undefined
      ? `Set groove to ${grooveById(command.grooveId).name}`
      : `Set groove amount ${Math.round((command.amount ?? 0) * 100)}%`,
  setLength: (command) => `Set loop length ${command.lengthBeats}`,
  setLoopStart: (command) => `Set loop start ${command.beats}`,
  addSample: (command) => `Imported "${command.name}"`,
  removeSample: () => "Removed sample",
};

export function describeCommand(command: EditCommand, ctx?: DescribeContext): string {
  // A persisted/restored log can contain command types from an older app version
  // (e.g. pre-rename `addVariant`); describe them by their raw type rather than
  // crashing the feed.
  const describe = DESCRIBE[command.type] as ((command: EditCommand, ctx?: DescribeContext) => string) | undefined;
  return describe ? describe(command, ctx) : command.type;
}
