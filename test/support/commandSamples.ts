/**
 * One valid command per type worth covering, plus a project with enough in it that each has a real
 * target.
 *
 * It was built to check that every command's inverse undid it, and then reused to check that
 * rebuilding the log without the command lands in the same place - running both off one table is
 * what checked the two undo paths against each other while DAW-34 changed over. The inverses are
 * gone; the table stays, because "apply this, rebuild without it, get back to where you were" is
 * the property undo now rests on, and it wants a real command per type to say it about.
 */
import { ProjectStore } from "../../src/audio/project/projectStore";
import { EditLog } from "../../src/audio/commands/editLog";
import type { EditCommand } from "../../src/audio/commands/types";
import type { GraphEffectDef, GraphInstrumentDef } from "../../src/audio/graph/types";

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
 * One command per covered type, with the edits needed to put the project somewhere non-default
 * first - undoing back to a default value proves very little.
 */
export interface Sample<K extends EditCommand["type"]> {
  setup: EditCommand[];
  command: Extract<EditCommand, { type: K }>;
}

export const SAMPLES = {
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
  // Edited while a track plays it, with a param turned: undoing has to put back the old schema on
  // the track's store as well as the old def.
  updateCustomInstrument: {
    setup: [
      { type: "addCustomInstrument", def: CUSTOM_INSTRUMENT },
      { type: "setInstrument", trackId: "t-1", instrumentType: CUSTOM_INSTRUMENT.type },
      { type: "setParam", trackId: "t-1", id: "amp.level", value: 0.3 },
    ],
    command: {
      type: "updateCustomInstrument",
      def: {
        ...CUSTOM_INSTRUMENT,
        label: "Invert Synth 2",
        schema: [
          ...CUSTOM_INSTRUMENT.schema,
          { id: "tone", label: "Tone", kind: "number", min: 0, max: 1, default: 0.25 },
        ],
      },
    },
  },
  updateCustomEffect: {
    setup: [
      { type: "addCustomEffect", def: CUSTOM_EFFECT },
      { type: "addEffect", hostId: "t-1", effectType: CUSTOM_EFFECT.type, id: "fx-custom" },
    ],
    command: {
      type: "updateCustomEffect",
      def: { ...CUSTOM_EFFECT, graph: { ...CUSTOM_EFFECT.graph, nodes: [{ id: "gain", kind: "gain", gain: 0.9 }] } },
    },
  },

  // Removed from the MIDDLE of the chain, with a non-default parameter and a bypass set, so the
  // inverse has to restore the slot and the state rather than just re-adding the device.
  removeEffect: {
    setup: [
      { type: "addEffect", hostId: "t-1", effectType: "delay", id: "fx-2" },
      { type: "setEffectParam", hostId: "t-1", effectId: "fx-1", id: "tremolo.rate", value: 7 },
      { type: "bypassEffect", hostId: "t-1", effectId: "fx-1", bypassed: true },
    ],
    command: { type: "removeEffect", hostId: "t-1", effectId: "fx-1" },
  },
  removeMidiDevice: {
    setup: [
      { type: "addMidiDevice", trackId: "t-1", deviceType: "arpeggiator", id: "md-2" },
      { type: "setMidiDeviceParam", trackId: "t-1", deviceId: "md-1", id: "level", value: 0.3 },
      { type: "bypassMidiDevice", trackId: "t-1", deviceId: "md-1", bypassed: true },
    ],
    command: { type: "removeMidiDevice", trackId: "t-1", deviceId: "md-1" },
  },
} satisfies { [K in EditCommand["type"]]?: Sample<K> };

/** The command types the table covers. */
export type SampledType = keyof typeof SAMPLES;
export const sampledTypes = (): SampledType[] => Object.keys(SAMPLES) as SampledType[];

/**
 * A project with enough in it that every sample above has a real target: an instrument track with a
 * note, an effect and a MIDI device, an audio track with a clip, and two groups to move between.
 * `addTrack` seeds the clip `c-t-1` and the placement `p-t-1`.
 */
export function seeded(): { project: ProjectStore; log: EditLog } {
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
