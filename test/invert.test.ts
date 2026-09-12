/**
 * The safety net for DAW-34. A wrong inverse silently corrupts a project, where a snapshot simply
 * cannot be wrong, so every inverter has to earn its place here before it is registered:
 *
 *  - apply a command, undo it, and the project is byte-identical to before;
 *  - redo it, and the project is byte-identical to after;
 *  - and the sample table is keyed by `InvertibleType`, so registering an inverter without a sample
 *    command is a compile error rather than an untested path.
 *
 * Samples run through `EditLog.dispatch`/`undo`/`redo` rather than calling `invert` directly, so the
 * checkpoint union and the coalescing path are covered too.
 */
import { describe, it, expect } from "vitest";
import { applyEdit } from "../src/audio/commands/applyEdit";
import { EditLog } from "../src/audio/commands/editLog";
import {
  authorshipBefore,
  invert,
  invertibleTypes,
  restoreAuthorship,
  type InvertibleType,
} from "../src/audio/commands/invert";
import type { EditCommand } from "../src/audio/commands/types";
import type { GraphEffectDef, GraphInstrumentDef } from "../src/audio/graph/types";
import { paramKey } from "../src/audio/commands/authorship";
import { conflictKeys, keysOverlap, undoConflictKeys } from "../src/audio/sync/conflict";
import { fingerprintProject } from "../src/audio/project/fingerprint";
import { ProjectStore } from "../src/audio/project/projectStore";

/**
 * Commands that COPY existing state into a new object. They are excluded from the second position in
 * the out-of-order test below, because "equals a world where `first` never happened" is the wrong
 * standard for them: a fork captures the clip as it stood, and undoing an earlier edit rightly does
 * not reach into a copy someone has already taken. Nothing is lost either way, which is the property
 * the gate actually has to protect.
 *
 * Not a general escape hatch. A command that *overwrites* what an intervening edit wrote is a real
 * conflict and stays in the test, which is what `undoConflictKeys` exists to catch.
 */
const CAPTURES_STATE = new Set<EditCommand["type"]>(["addClip", "pasteClip", "createTrackFromPatch"]);

/** A minimal custom instrument and effect, as data - enough for the add/remove pair to round trip. */
const CUSTOM_INSTRUMENT: GraphInstrumentDef = {
  type: "ci-invert",
  label: "Invert Synth",
  schema: [{ id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 }],
  voice: { nodes: [{ id: "osc", kind: "osc", waveform: "sawtooth" }], connections: [["osc", "amp"]] },
};

const CUSTOM_EFFECT: GraphEffectDef = {
  type: "ce-invert",
  label: "Invert Effect",
  schema: [{ id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.5 }],
  graph: {
    nodes: [{ id: "gain", kind: "gain", gain: 0.5 }],
    connections: [
      ["in", "gain"],
      ["gain", "wet"],
    ],
  },
};

/**
 * One command per invertible type, with the edits needed to put the project somewhere non-default
 * first - an inverse that restores a default value proves very little.
 */
interface Sample<K extends InvertibleType> {
  setup: EditCommand[];
  command: Extract<EditCommand, { type: K }>;
}

const SAMPLES: { [K in InvertibleType]: Sample<K> } = {
  renameProject: {
    setup: [{ type: "renameProject", name: "Before" }],
    command: { type: "renameProject", name: "After" },
  },
  setTempo: { setup: [{ type: "setTempo", bpm: 96 }], command: { type: "setTempo", bpm: 141 } },
  setTimeSignature: {
    setup: [{ type: "setTimeSignature", numerator: 3, denominator: 4 }],
    command: { type: "setTimeSignature", numerator: 7, denominator: 8 },
  },
  setGroove: {
    setup: [{ type: "setGroove", grooveId: "straight", amount: 0.25 }],
    command: { type: "setGroove", grooveId: "straight", amount: 0.75 },
  },
  // Shrinking the project also drags the loop start inside the new end, which is why this inverse is
  // two commands rather than one. A loop start deliberately outside the shrunk length.
  setLength: {
    setup: [
      { type: "setLength", lengthBeats: 64 },
      { type: "setLoopStart", beats: 48 },
    ],
    command: { type: "setLength", lengthBeats: 8 },
  },
  setLoopStart: { setup: [{ type: "setLoopStart", beats: 4 }], command: { type: "setLoopStart", beats: 9 } },

  setTrack: {
    setup: [{ type: "setTrack", trackId: "t-1", muted: true, volume: 0.3, name: "Bass" }],
    command: { type: "setTrack", trackId: "t-1", muted: false, volume: 0.9, name: "Lead" },
  },
  setGroup: {
    setup: [{ type: "setGroup", groupId: "g-1", name: "Perc", solo: true, collapsed: true }],
    command: { type: "setGroup", groupId: "g-1", name: "Kit", solo: false, collapsed: false },
  },
  moveTrack: {
    setup: [{ type: "moveTrack", trackId: "t-1", groupId: "g-1" }],
    command: { type: "moveTrack", trackId: "t-1", groupId: "g-2" },
  },
  moveGroup: {
    setup: [{ type: "moveGroup", groupId: "g-2", parentId: "g-1" }],
    command: { type: "moveGroup", groupId: "g-2", parentId: null },
  },

  setParam: {
    setup: [{ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 1200 }],
    command: { type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 3400 },
  },
  setEffectParam: {
    setup: [{ type: "setEffectParam", hostId: "t-1", effectId: "fx-1", id: "tremolo.rate", value: 2 }],
    command: { type: "setEffectParam", hostId: "t-1", effectId: "fx-1", id: "tremolo.rate", value: 9 },
  },
  setMidiDeviceParam: {
    setup: [{ type: "setMidiDeviceParam", trackId: "t-1", deviceId: "md-1", id: "level", value: 0.2 }],
    command: { type: "setMidiDeviceParam", trackId: "t-1", deviceId: "md-1", id: "level", value: 0.9 },
  },
  bypassEffect: {
    setup: [{ type: "bypassEffect", hostId: "t-1", effectId: "fx-1", bypassed: true }],
    command: { type: "bypassEffect", hostId: "t-1", effectId: "fx-1", bypassed: false },
  },
  bypassMidiDevice: {
    setup: [{ type: "bypassMidiDevice", trackId: "t-1", deviceId: "md-1", bypassed: true }],
    command: { type: "bypassMidiDevice", trackId: "t-1", deviceId: "md-1", bypassed: false },
  },

  renameClip: {
    setup: [{ type: "renameClip", trackId: "t-1", clipId: "c-t-1", name: "Verse" }],
    command: { type: "renameClip", trackId: "t-1", clipId: "c-t-1", name: "Chorus" },
  },
  // Only fields the clip already has, so the inverse is expressible; the unset case is covered
  // separately below.
  setAudioClip: {
    setup: [{ type: "setAudioClip", trackId: "at-1", clipId: "ac-1", patch: { gain: 0.4, name: "Dry" } }],
    command: { type: "setAudioClip", trackId: "at-1", clipId: "ac-1", patch: { gain: 0.8, name: "Wet" } },
  },
  movePlacement: {
    setup: [{ type: "movePlacement", trackId: "t-1", placementId: "p-t-1", startBeat: 4 }],
    command: { type: "movePlacement", trackId: "t-1", placementId: "p-t-1", startBeat: 12 },
  },
  // A left-edge trim: start, offset and length all move together in one command.
  resizePlacement: {
    setup: [{ type: "resizePlacement", trackId: "t-1", placementId: "p-t-1", startBeat: 4, offset: 0, length: 8 }],
    command: { type: "resizePlacement", trackId: "t-1", placementId: "p-t-1", startBeat: 6, offset: 2, length: 6 },
  },

  launchClip: {
    setup: [{ type: "launchClip", trackId: "t-1", clipId: "c-t-1" }],
    command: { type: "launchClip", trackId: "t-1", clipId: null },
  },
  stopAllClips: {
    setup: [
      { type: "launchClip", trackId: "t-1", clipId: "c-t-1" },
      { type: "launchClip", trackId: "at-1", clipId: "ac-1" },
    ],
    command: { type: "stopAllClips" },
  },

  // --- creation. Fresh ids throughout: a taken id is a separate case, tested below. ---
  // Named explicitly, like every creating sample here. An omitted name is filled in from the current
  // track count, so the command's effect would depend on what else exists - which is fine in the app
  // (the name was chosen in that world and undoing someone else's track does not rename yours) but
  // makes a sample that cannot be compared against "never happened".
  createTrack: {
    setup: [],
    command: { type: "createTrack", instrumentType: "subtractive", id: "t-new", name: "New Lead" },
  },
  createTrackFromPatch: {
    setup: [],
    command: {
      type: "createTrackFromPatch",
      id: "t-patch",
      name: "Patched",
      instrumentType: "subtractive",
      params: { "filter.cutoff": 900 },
      effects: [{ id: "fx-new", type: "reverb", params: { "reverb.decay": 3 } }],
    },
  },
  createAudioTrack: { setup: [], command: { type: "createAudioTrack", id: "at-new", name: "Room" } },
  addAudioTrack: {
    setup: [],
    command: {
      type: "addAudioTrack",
      id: "at-new2",
      fileId: "file-2",
      name: "Gtr",
      durationSec: 3,
      startBeat: 0,
      gain: 0.7,
    },
  },
  createGroup: { setup: [], command: { type: "createGroup", id: "g-new", name: "Bus" } },
  addEffect: { setup: [], command: { type: "addEffect", hostId: "t-1", effectType: "reverb", id: "fx-new" } },
  addMidiDevice: {
    setup: [],
    command: { type: "addMidiDevice", trackId: "t-1", deviceType: "arpeggiator", id: "md-new" },
  },
  addClip: { setup: [], command: { type: "addClip", trackId: "t-1", id: "c-new", name: "B" } },
  pasteClip: {
    setup: [],
    command: {
      type: "pasteClip",
      trackId: "t-1",
      id: "c-paste",
      content: { kind: "instrument", name: "Copy", lengthBeats: 8, notes: [] },
    },
  },
  addPlacement: {
    setup: [],
    command: { type: "addPlacement", trackId: "t-1", id: "p-new", clipId: "c-t-1", startBeat: 24, length: 4 },
  },
  addSample: {
    setup: [],
    command: { type: "addSample", id: "s-new", name: "Kick.wav", contentHash: "hash-1" },
  },
  addCustomInstrument: { setup: [], command: { type: "addCustomInstrument", def: CUSTOM_INSTRUMENT } },
  addCustomEffect: { setup: [], command: { type: "addCustomEffect", def: CUSTOM_EFFECT } },

  // --- removal whose inverse is an existing add ---
  addNote: {
    setup: [],
    command: {
      type: "addNote",
      trackId: "t-1",
      clipId: "c-t-1",
      note: { id: "n-new", pitch: 67, start: 2, length: 1, velocity: 0.6 },
    },
  },
  removeNote: { setup: [], command: { type: "removeNote", trackId: "t-1", clipId: "c-t-1", id: "n-1" } },
  removeNotes: {
    setup: [
      {
        type: "addNotes",
        trackId: "t-1",
        clipId: "c-t-1",
        notes: [{ id: "n-2", pitch: 64, start: 1, length: 1, velocity: 0.5 }],
      },
    ],
    command: { type: "removeNotes", trackId: "t-1", clipId: "c-t-1", ids: ["n-1", "n-2"] },
  },
  // A second placement, not the seeded one: `load` heals a note track with no placements by making
  // one, so a project whose track has zero placements does not survive a reload to compare against.
  removePlacement: {
    setup: [{ type: "addPlacement", trackId: "t-1", id: "p-extra", clipId: "c-t-1", startBeat: 32, length: 4 }],
    command: { type: "removePlacement", trackId: "t-1", placementId: "p-extra" },
  },
  removeSample: {
    setup: [{ type: "addSample", id: "s-1", name: "Snare.wav", contentHash: "hash-2", source: "upload" }],
    command: { type: "removeSample", id: "s-1" },
  },
  removeCustomInstrument: {
    setup: [{ type: "addCustomInstrument", def: CUSTOM_INSTRUMENT }],
    command: { type: "removeCustomInstrument", deviceType: CUSTOM_INSTRUMENT.type },
  },
  removeCustomEffect: {
    setup: [{ type: "addCustomEffect", def: CUSTOM_EFFECT }],
    command: { type: "removeCustomEffect", deviceType: CUSTOM_EFFECT.type },
  },
};

/**
 * A project with enough in it that every sample below has a real target: an instrument track with a
 * note, an effect and a MIDI device, an audio track with a clip, and two groups to move between.
 * `addTrack` seeds the clip `c-t-1` and the placement `p-t-1`.
 */
function seeded(): { project: ProjectStore; log: EditLog } {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
  log.dispatch({
    type: "addNote",
    trackId: "t-1",
    note: { id: "n-1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
  });
  log.dispatch({ type: "addEffect", hostId: "t-1", effectType: "tremolo", id: "fx-1" });
  log.dispatch({ type: "addMidiDevice", trackId: "t-1", deviceType: "octavator", id: "md-1" });
  log.dispatch({ type: "createGroup", id: "g-1", name: "Drums" });
  log.dispatch({ type: "createGroup", id: "g-2", name: "Keys" });
  log.dispatch({ type: "createAudioTrack", id: "at-1", name: "Vox" });
  log.dispatch({
    type: "addAudioClip",
    trackId: "at-1",
    id: "ac-1",
    placementId: "ap-1",
    fileId: "file-1",
    name: "Take 1",
    durationSec: 4,
    gain: 0.5,
  });
  // Setup and the command under test must not fold into one gesture, or undo would step back past
  // both and the inverse would never be exercised.
  log.resetCoalescing();
  return { project, log };
}

describe("invert", () => {
  it("has a sample command for every registered inverter", () => {
    // The table is keyed by InvertibleType so this cannot actually fail to compile-and-pass; it is
    // here to name the invariant, and to fail loudly if the table is ever widened by hand.
    expect(Object.keys(SAMPLES).sort()).toEqual(invertibleTypes().sort());
  });

  describe.each(invertibleTypes())("%s", (type) => {
    const sample = SAMPLES[type] as Sample<InvertibleType>;

    it("has an inverse, so it takes the cheap checkpoint", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const inverse = invert(project, sample.command);
      expect(inverse).not.toBeNull();
      expect(inverse?.length).toBeGreaterThan(0);
    });

    it("undoes to a byte-identical project, and redoes back", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const before = fingerprintProject(project.snapshot());

      log.dispatch(sample.command);
      const after = fingerprintProject(project.snapshot());
      // A sample that changes nothing would pass every assertion below without testing anything.
      expect(after).not.toBe(before);

      log.undo();
      expect(fingerprintProject(project.snapshot())).toBe(before);

      log.redo();
      expect(fingerprintProject(project.snapshot())).toBe(after);
    });

    it("survives a round trip through the persisted stack", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const before = fingerprintProject(project.snapshot());
      log.dispatch(sample.command);
      const after = fingerprintProject(project.snapshot());

      // What a reload does: the same project state, plus the packed stack written beside it.
      const packed = JSON.parse(JSON.stringify(log.getCheckpoints()));
      const reloaded = new ProjectStore(false);
      reloaded.load(JSON.parse(JSON.stringify(project.snapshot())));
      const reloadedLog = new EditLog(reloaded);
      reloadedLog.restoreCheckpoints(packed);

      expect(fingerprintProject(reloaded.snapshot())).toBe(after);
      reloadedLog.undo();
      expect(fingerprintProject(reloaded.snapshot())).toBe(before);
      reloadedLog.redo();
      expect(fingerprintProject(reloaded.snapshot())).toBe(after);
    });
  });

  /**
   * An inverse checkpoint applies commands rather than restoring a snapshot, and `applyEdit` stamps
   * authorship as it goes - so without the captured `authors` an undo would re-attribute the object
   * to whoever undid it. The per-sample tests above cannot catch a missing capture because they are
   * single-author; this one edits as "claude" and undoes as "you".
   */
  it("restores the authorship the edit stamped over, across a reload", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 1200 }, "claude");
    log.resetCoalescing();
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 3400 }, "you");
    expect(project.authorOf(paramKey("t-1", "filter.cutoff"))).toBe("you");

    // The stack has to carry the stamp through JSON, not just hold it in memory.
    const packed = JSON.parse(JSON.stringify(log.getCheckpoints()));
    const reloaded = new ProjectStore(false);
    reloaded.load(JSON.parse(JSON.stringify(project.snapshot())));
    const reloadedLog = new EditLog(reloaded);
    reloadedLog.restoreCheckpoints(packed);

    reloadedLog.undo();
    // Alden's call: the stamp names whoever authored the value you can see, so undoing back to
    // Claude's value hands the tint back to Claude rather than keeping it on the undoer.
    expect(reloaded.authorOf(paramKey("t-1", "filter.cutoff"))).toBe("claude");
  });

  /**
   * The gate that makes out-of-order and author-scoped undo safe (DAW-34) trusts `conflictKeys`:
   * non-overlapping keys are taken as a licence to apply an inverse out of order. Assert the claim
   * the gate actually rests on, which is narrower than "the two commands commute": taking `first`
   * back after `second` has landed must give the same project as never having done `first` at all.
   *
   * The difference matters. `createTrack` then `createAudioTrack` genuinely does not commute (the
   * track list is ordered), but undoing the first is still exact, because its inverse removes by id
   * and does not care what else arrived. Testing forward commutativity would have failed that pair
   * and pushed us to key it as a conflict for no reason.
   *
   * Compared on a *canonical* snapshot: `applyEdit` writes the authorship record as it goes, and
   * key order there is not part of the project's meaning.
   */
  it("an inverse still undoes its command after a disjoint edit lands on top", () => {
    /** JSON with object keys sorted, so insertion order stops counting as a difference. Array order
     *  is left alone: a track list and a note list mean something in order. */
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonical(nested)]),
            )
          : value;

    const commands = invertibleTypes().map((type) => (SAMPLES[type] as Sample<InvertibleType>).command);
    const pairs = commands.flatMap((first) =>
      commands
        .filter((second) => second.type !== first.type)
        .filter((second) => !CAPTURES_STATE.has(second.type))
        .map((second) => [first, second] as const),
    );
    let checked = 0;

    for (const [first, second] of pairs) {
      // Do `first`, let `second` land on top, then take `first` back the way `EditLog.rewind` does.
      const { project: outOfOrder } = seeded();
      const inverse = invert(outOfOrder, first);
      if (inverse === null) continue; // declined an inverse, so it takes a snapshot and the gate never sees it
      // The gate's own question, asked with the gate's own key function: only pairs it would let
      // through are claims we have to honour.
      if (keysOverlap(undoConflictKeys(first, inverse), conflictKeys(second))) continue;
      checked++;
      const authors = authorshipBefore(outOfOrder, first);
      applyEdit(outOfOrder, first, "you");
      applyEdit(outOfOrder, second, "you");
      for (const command of inverse) applyEdit(outOfOrder, command, "you");
      restoreAuthorship(outOfOrder, authors);

      // What the project would be if `first` had never happened.
      const { project: never } = seeded();
      applyEdit(never, second, "you");

      expect(canonical(outOfOrder.snapshot()), `${first.type} then ${second.type}`).toEqual(
        canonical(never.snapshot()),
      );
    }
    expect(checked).toBeGreaterThan(0);
  });
});
