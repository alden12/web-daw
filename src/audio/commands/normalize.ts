/**
 * Resolves a command's ambient defaults before it becomes durable (DAW-36).
 *
 * Several commands take a default from whatever the project happens to look like when they are
 * applied - most of all a note edit, whose `clipId` falls back to the track's active clip. That
 * makes `applyEdit` a function of more than `(state, command)`, and a logged entry ambiguous about
 * what it actually did: "add this note to whichever clip is active" only replays correctly because
 * the active clip is itself derived from the same log in the same order. Anything that reorders,
 * excludes or re-bases an entry breaks it silently - revert-to-a-point (DAW-8.16), an offline queue
 * flushed after a peer's edits, and the rebuild path undo is moving to (DAW-34).
 *
 * `EditLog.dispatch` normalises once, before the checkpoint, the apply, the log entry and the
 * forward to the authority, so all four see the same self-contained command. One object-map entry
 * per command type, per the project conventions; a type with no entry passes through untouched.
 *
 * **The optional fields stay optional in the type.** "The clip I have open" is the right thing for
 * the UI or the MCP boundary to say, and they should go on saying it. What changes is that it stops
 * being optional by the time anything stores or sends it.
 */
import type { ProjectStore } from "../project/projectStore";
import type { EditCommand } from "./types";

type Normalizer<K extends EditCommand["type"]> = (
  project: ProjectStore,
  command: Extract<EditCommand, { type: K }>,
) => Extract<EditCommand, { type: K }>;

type NormalizeMap = { [K in EditCommand["type"]]: Normalizer<K> };

/**
 * Pin a note edit to the clip it actually landed in. Left alone when the command already names one,
 * and when the track (or its active clip) cannot be resolved - an unresolvable command is a no-op in
 * `applyEdit` anyway, and inventing a clip id here would be a guess rather than a resolution.
 */
const pinActiveClip = <Command extends { trackId: string; clipId?: string }>(
  project: ProjectStore,
  command: Command,
): Command => {
  if (command.clipId !== undefined) return command;
  const activeClipId = project.getTrack(command.trackId)?.activeClipId;
  return activeClipId ? { ...command, clipId: activeClipId } : command;
};

/** A default that resolved to nothing (an unknown track, a clip that is not there) leaves the field
 *  as it was: the command is a no-op in `applyEdit` either way, and a guess would be worse. */
const pin = <Command, Field extends keyof Command>(
  command: Command,
  field: Field,
  value: Command[Field] | undefined,
): Command => (command[field] !== undefined || value === undefined ? command : { ...command, [field]: value });

const NORMALIZE = {
  addNote: pinActiveClip,
  addNotes: pinActiveClip,
  editNotes: pinActiveClip,
  removeNote: pinActiveClip,
  removeNotes: pinActiveClip,
  clearClip: pinActiveClip,
  setClipLength: pinActiveClip,

  // Creation defaults. A name counts what already exists, and a clip's seed follows the track's
  // active clip and the project length, so all of them move between a dispatch and a replay.
  createTrack: (project, command) =>
    pin(pin(command, "name", project.defaultTrackName(command.instrumentType)), "lengthBeats", project.length),
  createTrackFromPatch: (project, command) =>
    pin(pin(command, "name", project.defaultTrackName(command.instrumentType)), "lengthBeats", project.length),
  createAudioTrack: (project, command) => pin(command, "name", project.defaultAudioTrackName()),
  createGroup: (project, command) => pin(command, "name", project.defaultGroupName()),
  // An audio placement's length is its duration at the tempo of the moment, and audio is not
  // time-stretched (DAW-35), so a replay at another tempo would lay out a different region.
  addAudioTrack: (project, command) =>
    pin(
      pin(command, "name", project.defaultAudioTrackName()),
      "length",
      project.naturalBeats(command.durationSec ?? 0),
    ),
  addAudioClip: (project, command) => pin(command, "length", project.naturalBeats(command.durationSec ?? 0)),
  addClip: (project, command) => {
    const seed = project.clipSeed(command.trackId, command);
    const named = pin(command, "name", project.defaultClipName(command.trackId));
    const forked = command.empty ? named : pin(named, "fromClipId", seed?.fromClipId);
    return pin(forked, "lengthBeats", seed?.lengthBeats);
  },
  addPlacement: (project, command) => {
    // An audio track with nothing in its pool has `activeClipId: ""`, which names no clip.
    const placed = pin(command, "clipId", project.getTrack(command.trackId)?.activeClipId || undefined);
    return placed.clipId === undefined
      ? placed
      : pin(placed, "length", project.defaultPlacementLength(placed.trackId, placed.clipId));
  },
} satisfies Partial<NormalizeMap>;

/** Command types that carry an ambient default this module resolves. Exported for the tests. */
export type NormalizedType = keyof typeof NORMALIZE;
export const normalizedTypes = (): NormalizedType[] => Object.keys(NORMALIZE) as NormalizedType[];

/** The command as it should be applied, logged, forwarded and mirrored: nothing left to infer. */
export function normalizeCommand(project: ProjectStore, command: EditCommand): EditCommand {
  const normalizer = (NORMALIZE as Partial<NormalizeMap>)[command.type] as Normalizer<EditCommand["type"]> | undefined;
  return normalizer ? normalizer(project, command) : command;
}
