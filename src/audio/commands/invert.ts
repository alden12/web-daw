/**
 * `invert(project, command)` returns the commands that undo `command`, or `null` when that command
 * type has no inverter yet. Called from `EditLog.dispatch` immediately BEFORE `applyEdit`, which is
 * the only moment the pre-edit state is available, and is exactly where the whole-project snapshot
 * checkpoint is taken today. See DAW-34.
 *
 * The map is deliberately `Partial`: coverage lands command-by-command, and an unmapped type falls
 * back to a snapshot checkpoint, so migration risk is per-command rather than big-bang. That is why
 * an unmapped type returns null instead of throwing.
 *
 * **An inverse is a list, not one command.** One command can change several things: `setLength` also
 * re-clamps the loop start, and `editNotes` both creates and modifies (so taking it back means
 * restoring some notes and removing others). The list is applied in order, so an inverter orders its
 * commands so each one's precondition is already restored - undo the length before the loop start,
 * because the loop start's clamp window depends on it.
 *
 * **Read old values off the store, not off the command.** The store coerces (clamps tempo, rounds a
 * numerator, ignores an invalid denominator), so the value it *holds* is the one an undo has to
 * restore; the value a caller *asked for* may never have landed.
 *
 * Every inverter here is covered by the round-trip property test in `test/invert.test.ts`: apply the
 * command, apply its inverse, and the project must be byte-identical to before. Add an inverter and
 * its sample command together - the sample table is a mapped type, so a missing sample is a compile
 * error.
 */
import type { ClipAuthor } from "../project/schema";
import type { AudioClipData } from "../project/types";
import type { Group, ProjectStore, Track } from "../project/projectStore";
import { authorshipEffect, clipKey, noteEditClipTarget } from "./authorship";
import type { EditCommand } from "./types";

/**
 * The authorship an edit is about to overwrite, keyed the same way `ProjectStore.authorship` is.
 * `null` records a key that had no author, which undo restores by dropping the stamp rather than
 * writing one.
 */
export type PriorAuthors = Record<string, ClipAuthor | null>;

/**
 * The current value of exactly the fields a patch-style command set (`setTrack`, `setGroup`,
 * `setAudioClip`). Restoring more than the command changed would quietly write back fields the edit
 * never touched; restoring fewer would leave part of it applied. The command's field names match the
 * target object's, which is what lets one helper serve all three.
 */
const currentFields = <Target, Key extends keyof Target & string>(
  command: Partial<Record<Key, unknown>>,
  current: Target,
  fields: readonly Key[],
): Partial<Pick<Target, Key>> =>
  Object.fromEntries(
    fields.filter((field) => command[field] !== undefined).map((field) => [field, current[field]]),
  ) as Partial<Pick<Target, Key>>;

/** Which clip a command targets: its explicit id, or the track's active one (the same default `applyEdit`
 *  resolves). The inverse pins the resolved id, because the active clip can move before an undo. */
const targetClipId = (project: ProjectStore, trackId: string, clipId?: string): string | undefined =>
  clipId ?? project.getTrack(trackId)?.activeClipId ?? undefined;

/**
 * Reads the pre-edit state off `project` and returns the commands that reverse `command`. An empty
 * list is a valid answer (the command targeted something that is not there, so it will no-op and
 * undoing it is also a no-op). Null means *this particular* edit cannot be expressed as an inverse
 * even though its type usually can, so it falls back to a snapshot checkpoint.
 */
export type Inverter<K extends EditCommand["type"]> = (
  project: ProjectStore,
  command: Extract<EditCommand, { type: K }>,
) => EditCommand[] | null;

/**
 * The patch fields each patch-style command carries, named the same on the command and on the target
 * object. `satisfies` is what makes a misspelled field a compile error here, at the declaration -
 * inferring the constraint through `currentFields` silently let one through.
 */
const TRACK_FIELDS = ["muted", "solo", "volume", "name"] as const satisfies readonly (keyof Track)[];
const GROUP_FIELDS = ["name", "muted", "solo", "volume", "collapsed"] as const satisfies readonly (keyof Group)[];
const AUDIO_CLIP_FIELDS = [
  "gain",
  "name",
  "loopStartSec",
  "loopEndSec",
  "gridOffsetSec",
] as const satisfies readonly (keyof AudioClipData)[];

/** The full shape, so the map below can only hold real command types. */
type InvertMap = { [K in EditCommand["type"]]: Inverter<K> };

/**
 * `satisfies` rather than a type annotation, so `InvertibleType` below is the *actual* set of
 * registered types. That is what lets the round-trip test demand a sample command per inverter and
 * fail to compile when one is added without one.
 */
const INVERT = {
  renameProject: (project) => [{ type: "renameProject", name: project.name }],
  setTempo: (project) => [{ type: "setTempo", bpm: project.tempo }],
  setTimeSignature: (project) => [
    {
      type: "setTimeSignature",
      numerator: project.timeSignature.numerator,
      denominator: project.timeSignature.denominator,
    },
  ],
  setGroove: (project) => {
    const groove = project.getGroove();
    return [{ type: "setGroove", grooveId: groove.id, amount: groove.amount }];
  },
  // Length first, then loop start: `setLength` drags the loop start inside the new end, so restoring
  // the length alone would leave a moved loop start behind.
  setLength: (project) => [
    { type: "setLength", lengthBeats: project.length },
    { type: "setLoopStart", beats: project.loopStart },
  ],
  setLoopStart: (project) => [{ type: "setLoopStart", beats: project.loopStart }],

  // --- tracks and groups ----------------------------------------------------
  setTrack: (project, command) => {
    const track = project.getTrack(command.trackId);
    if (!track) return [];
    return [{ type: "setTrack", trackId: command.trackId, ...currentFields(command, track, TRACK_FIELDS) }];
  },
  setGroup: (project, command) => {
    const group = project.getGroup(command.groupId);
    if (!group) return [];
    return [{ type: "setGroup", groupId: command.groupId, ...currentFields(command, group, GROUP_FIELDS) }];
  },
  moveTrack: (project, command) => {
    const track = project.getTrack(command.trackId);
    return track ? [{ type: "moveTrack", trackId: command.trackId, groupId: track.parentId }] : [];
  },
  moveGroup: (project, command) => {
    const group = project.getGroup(command.groupId);
    return group ? [{ type: "moveGroup", groupId: command.groupId, parentId: group.parentId }] : [];
  },

  // --- parameters and bypass ------------------------------------------------
  // `ParamStore.get` throws on an id the schema does not declare, so every read is guarded by `has`.
  // An unguarded read would turn "this edit was a no-op" into a crash at dispatch time.
  setParam: (project, command) => {
    const track = project.getTrack(command.trackId);
    if (track?.kind !== "instrument" || !track.params.has(command.id)) return [];
    return [{ type: "setParam", trackId: command.trackId, id: command.id, value: track.params.get(command.id) }];
  },
  setEffectParam: (project, command) => {
    const effect = project.getEffect(command.hostId, command.effectId);
    if (!effect?.params.has(command.id)) return [];
    return [
      {
        type: "setEffectParam",
        hostId: command.hostId,
        effectId: command.effectId,
        id: command.id,
        value: effect.params.get(command.id),
      },
    ];
  },
  setMidiDeviceParam: (project, command) => {
    const device = project.getMidiDevice(command.trackId, command.deviceId);
    if (!device?.params.has(command.id)) return [];
    return [
      {
        type: "setMidiDeviceParam",
        trackId: command.trackId,
        deviceId: command.deviceId,
        id: command.id,
        value: device.params.get(command.id),
      },
    ];
  },
  bypassEffect: (project, command) => {
    const effect = project.getEffect(command.hostId, command.effectId);
    if (!effect) return [];
    return [{ type: "bypassEffect", hostId: command.hostId, effectId: command.effectId, bypassed: effect.bypassed }];
  },
  bypassMidiDevice: (project, command) => {
    const device = project.getMidiDevice(command.trackId, command.deviceId);
    if (!device) return [];
    return [
      {
        type: "bypassMidiDevice",
        trackId: command.trackId,
        deviceId: command.deviceId,
        bypassed: device.bypassed,
      },
    ];
  },

  // --- clips and placements -------------------------------------------------
  renameClip: (project, command) => {
    const clip = project.getTrack(command.trackId)?.clips.find((clip) => clip.id === command.clipId);
    return clip ? [{ type: "renameClip", trackId: command.trackId, clipId: command.clipId, name: clip.name }] : [];
  },
  movePlacement: (project, command) => {
    const placement = project
      .getTrack(command.trackId)
      ?.placements.find((placement) => placement.id === command.placementId);
    if (!placement) return [];
    return [
      {
        type: "movePlacement",
        trackId: command.trackId,
        placementId: command.placementId,
        startBeat: placement.startBeat,
      },
    ];
  },
  // All three fields, not just the ones the command set: a left-edge trim moves start, offset and
  // length together, and restoring a field the command left alone costs nothing (it is unchanged).
  resizePlacement: (project, command) => {
    const placement = project
      .getTrack(command.trackId)
      ?.placements.find((placement) => placement.id === command.placementId);
    if (!placement) return [];
    return [
      {
        type: "resizePlacement",
        trackId: command.trackId,
        placementId: command.placementId,
        startBeat: placement.startBeat,
        offset: placement.offset,
        length: placement.length,
      },
    ];
  },

  /**
   * Returns null (falling back to a snapshot) when the edit set a field the clip did not have: the
   * patch cannot say "unset", so restoring an absent `loopStartSec` is not expressible as a command.
   * Undo still works, it is just the expensive kind for that one edit - which is what the mixed
   * checkpoint union is for.
   */
  setAudioClip: (project, command) => {
    const clipId = targetClipId(project, command.trackId, command.clipId);
    const track = project.getTrack(command.trackId);
    const clip = track?.kind === "audio" ? track.clips.find((clip) => clip.id === clipId) : undefined;
    if (!clip) return [];
    const patch = currentFields(command.patch, clip, AUDIO_CLIP_FIELDS);
    const unsettable = Object.keys(patch).some((field) => patch[field as keyof typeof patch] === undefined);
    if (unsettable) return null;
    return [{ type: "setAudioClip", trackId: command.trackId, clipId, patch }];
  },

  // --- clip launching -------------------------------------------------------
  launchClip: (project, command) => {
    const track = project.getTrack(command.trackId);
    return track ? [{ type: "launchClip", trackId: command.trackId, clipId: track.launchedClipId }] : [];
  },
  // One `launchClip` per track that had something playing. The list shape is doing real work here:
  // there is no single command that re-launches a whole project's worth of clips.
  stopAllClips: (project) =>
    project
      .getTracks()
      .filter((track) => track.launchedClipId !== null)
      .map((track) => ({ type: "launchClip", trackId: track.id, clipId: track.launchedClipId })),
} satisfies Partial<InvertMap>;

/** The command types that can be undone by inverse today. The rest still take a snapshot. */
export type InvertibleType = keyof typeof INVERT;

/** Those types at runtime, for tests and diagnostics. */
export const invertibleTypes = (): InvertibleType[] => Object.keys(INVERT) as InvertibleType[];

/**
 * The authorship `applyEdit` is about to stamp over, captured before the command runs.
 *
 * A snapshot checkpoint restored authorship along with everything else; an inverse checkpoint has to
 * carry it, or undo would re-attribute the object to whoever pressed undo. Alden's call: the stamp
 * names whoever authored the value you can actually see, so taking an edit back takes its stamp back
 * too.
 *
 * The key set mirrors what `applyEdit` stamps - the command's touched and removed keys, plus the
 * clip a note edit implies - so the two must be changed together. A `prefix:` entry is expanded to
 * the stamped keys under it, since that is what `dropAuthors` will clear.
 */
export function authorshipBefore(project: ProjectStore, command: EditCommand): PriorAuthors {
  const effect = authorshipEffect(command);
  const noteTarget = noteEditClipTarget(command);
  const noteClipId = noteTarget ? (noteTarget.clipId ?? project.getTrack(noteTarget.trackId)?.activeClipId) : undefined;
  const entries = [...(effect.touched ?? []), ...(effect.removed ?? []), ...(noteClipId ? [clipKey(noteClipId)] : [])];
  const keys = entries.flatMap((entry) => (entry.endsWith(":") ? project.authorKeysUnder(entry) : [entry]));
  return Object.fromEntries(keys.map((key) => [key, project.authorOf(key) ?? null]));
}

/** Put back the authorship an edit stamped over (see `authorshipBefore`). */
export function restoreAuthorship(project: ProjectStore, authors: PriorAuthors): void {
  const unstamped = Object.keys(authors).filter((key) => authors[key] === null);
  if (unstamped.length > 0) project.dropAuthors(unstamped);
  for (const [key, author] of Object.entries(authors)) if (author !== null) project.setAuthor(key, author);
}

/**
 * The commands that reverse `command`, read against the project's CURRENT (pre-edit) state, or null
 * when this command type has no inverter yet.
 */
export function invert(project: ProjectStore, command: EditCommand): EditCommand[] | null {
  const inverter = (INVERT as Partial<InvertMap>)[command.type] as Inverter<EditCommand["type"]> | undefined;
  return inverter ? inverter(project, command) : null;
}
