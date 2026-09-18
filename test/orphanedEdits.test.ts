/**
 * Undoing something other edits were built on top of (DAW-34).
 *
 * Rebuild-based undo replays the log with one entry left out, which routinely leaves later edits
 * pointing at things that no longer exist: notes added to an undone track, params set on an undone
 * effect. Those edits should be **skipped, not fatal** - a rebuild that throws takes the whole
 * project with it, so one unapplicable edit would make the undo unavailable rather than partial.
 *
 * Nearly every command already no-ops, because it resolves its target and gives up when it is gone.
 * `setParam` was the exception, and the case that found it is not exotic: undo a `setInstrument` and
 * every later param edit names a parameter of the instrument that is no longer there.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { rebuildWithout } from "../src/audio/commands/replay";
import type { EditCommand, EditEntry } from "../src/audio/commands/types";

const trackId = "t-1";
const clipId = "c-1";

/** A track's whole life, so leaving out its creation orphans one of every kind of edit. */
const trackLife: EditCommand[] = [
  { type: "createTrack", instrumentType: "subtractive", id: trackId, name: "Bass" },
  { type: "addClip", trackId, id: clipId, name: "Riff", empty: true },
  { type: "addNote", trackId, clipId, note: { id: "n-1", start: 0, length: 1, pitch: 60, velocity: 0.8 } },
  { type: "addNotes", trackId, clipId, notes: [{ id: "n-2", start: 1, length: 1, pitch: 62, velocity: 0.8 }] },
  { type: "editNotes", trackId, clipId, notes: [{ id: "n-2", start: 2, length: 1, pitch: 64, velocity: 0.9 }] },
  { type: "removeNote", trackId, clipId, id: "n-1" },
  { type: "removeNotes", trackId, clipId, ids: ["n-2"] },
  { type: "clearClip", trackId, clipId },
  { type: "setClipLength", trackId, clipId, lengthBeats: 8 },
  { type: "renameClip", trackId, clipId, name: "Riff 2" },
  { type: "setTrack", trackId, muted: true, solo: false, volume: 0.5, name: "Bassline" },
  { type: "setParam", trackId, id: "amp.level", value: 0.4 },
  { type: "setInstrument", trackId, instrumentType: "fm" },
  { type: "addEffect", hostId: trackId, effectType: "delay", id: "fx-1" },
  { type: "setEffectParam", hostId: trackId, effectId: "fx-1", id: "mix", value: 0.3 },
  { type: "bypassEffect", hostId: trackId, effectId: "fx-1", bypassed: true },
  { type: "moveEffect", hostId: trackId, effectId: "fx-1", toIndex: 0 },
  { type: "removeEffect", hostId: trackId, effectId: "fx-1" },
  { type: "addMidiDevice", trackId, deviceType: "octavator", id: "md-1" },
  { type: "setMidiDeviceParam", trackId, deviceId: "md-1", id: "level", value: 0.5 },
  { type: "bypassMidiDevice", trackId, deviceId: "md-1", bypassed: true },
  { type: "moveMidiDevice", trackId, deviceId: "md-1", toIndex: 0 },
  { type: "removeMidiDevice", trackId, deviceId: "md-1" },
  { type: "addPlacement", trackId, id: "p-1", clipId, startBeat: 0, offset: 0, length: 4 },
  { type: "movePlacement", trackId, placementId: "p-1", startBeat: 4 },
  { type: "resizePlacement", trackId, placementId: "p-1", startBeat: 4, offset: 0, length: 8 },
  { type: "splitPlacement", trackId, placementId: "p-1", atBeat: 6, newId: "p-2" },
  { type: "removePlacement", trackId, placementId: "p-1" },
  { type: "launchClip", trackId, clipId },
  { type: "moveTrack", trackId, groupId: null },
  { type: "removeClip", trackId, clipId },
];

const log = (commands: readonly EditCommand[]): EditEntry[] =>
  commands.map((command, index) => ({ seq: index, id: `e-${index}`, command, author: "you", time: 0, kind: "edit" }));

const rebuiltWithout = (commands: readonly EditCommand[], excluded: number) =>
  rebuildWithout(new ProjectStore(false).snapshot(), -1, log(commands), new Set([`e-${excluded}`]));

describe("an edit whose target was undone", () => {
  it("is skipped, however many later edits depended on it", () => {
    const rebuilt = rebuiltWithout(trackLife, 0);

    expect(rebuilt.tracks).toHaveLength(0);
  });

  it("does not take the rebuild with it when it names a parameter that is now unknown", () => {
    const changedInstrument: EditCommand[] = [
      { type: "createTrack", instrumentType: "subtractive", id: trackId, name: "Lead" },
      { type: "setInstrument", trackId, instrumentType: "fm" },
      { type: "setParam", trackId, id: "fm.ratio", value: 4 },
    ];

    const rebuilt = rebuiltWithout(changedInstrument, 1);

    // The track is back to the instrument it started with, and the fm-only param simply did not land.
    expect(rebuilt.tracks[0]).toMatchObject({ instrumentType: "subtractive" });
  });

  it("leaves a track whose group is gone parented to main, rather than to nothing", () => {
    const grouped: EditCommand[] = [
      { type: "createGroup", id: "g-1", name: "Drums" },
      { type: "createTrack", instrumentType: "subtractive", id: trackId, name: "Kick" },
      { type: "moveTrack", trackId, groupId: "g-1" },
    ];

    const rebuilt = rebuiltWithout(grouped, 0);

    expect(rebuilt.groups.map((group) => group.id)).toEqual(["g-main"]);
    expect(rebuilt.tracks[0]).toMatchObject({ parentId: "g-main" });
  });

  it("does not divert notes to another clip when the clip they name is gone", () => {
    const twoClips: EditCommand[] = [
      { type: "createTrack", instrumentType: "subtractive", id: trackId, name: "Kick" },
      { type: "addClip", trackId, id: "c-9", name: "B", empty: true },
      { type: "addNote", trackId, clipId: "c-9", note: { id: "n-1", start: 0, length: 1, pitch: 60, velocity: 0.8 } },
    ];

    const rebuilt = rebuiltWithout(twoClips, 1);
    const clips = (rebuilt.tracks[0] as { clips: { id: string; notes: unknown[] }[] }).clips;

    expect(clips.map((clip) => clip.id)).not.toContain("c-9");
    expect(clips.flatMap((clip) => clip.notes)).toHaveLength(0);
  });
});
