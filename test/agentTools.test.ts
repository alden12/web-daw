import { beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { createAgentTools } from "../src/audio/agent/tools";
import type { AgentTool } from "../src/audio/agent/types";
import type { Scheduler } from "../src/audio/sequencer/scheduler";

// Transport tools only need play/stop/isPlaying; a stub avoids standing up Web Audio.
const stubScheduler = {
  play() {},
  stop() {},
  get isPlaying() {
    return false;
  },
} as unknown as Scheduler;

let store: ProjectStore;
let tools: AgentTool[];
const tool = (name: string): AgentTool => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

beforeEach(() => {
  store = new ProjectStore();
  const editLog = new EditLog(store);
  tools = createAgentTools({ projectStore: store, dispatch: editLog.dispatch, scheduler: stubScheduler });
});

describe("createAgentTools - reads", () => {
  it("list_tracks reports the instrument palette from the catalog", async () => {
    const result = (await tool("list_tracks").run({})) as { instruments: { type: string }[] };
    const types = result.instruments.map((info) => info.type);
    expect(types).toContain("subtractive");
    expect(types).not.toContain("none"); // hidden sentinel excluded
  });
});

describe("createAgentTools - writes go through dispatch", () => {
  it("create_track adds an instrument track that shows up in the store", async () => {
    const created = (await tool("create_track").run({ instrument: "subtractive", name: "Bass" })) as {
      ok: boolean;
      trackId: string;
    };
    expect(created.ok).toBe(true);
    const track = store.getTrack(created.trackId);
    expect(track?.name).toBe("Bass");
    expect(track?.kind).toBe("instrument");
  });

  it("rejects an unknown instrument type", async () => {
    await expect(tool("create_track").run({ instrument: "bogus" })).rejects.toThrow(/Unknown instrument/);
  });

  it("add_notes writes notes (with defaults) that list_notes reads back", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    await tool("add_notes").run({
      track: trackId,
      notes: [
        { pitch: 60, start: 0 },
        { pitch: 64, start: 1, length: 2 },
      ],
    });

    const listed = (await tool("list_notes").run({ track: trackId })) as {
      notes: { pitch: number; start: number; length: number; velocity: number }[];
    };
    expect(listed.notes).toHaveLength(2);
    const first = listed.notes.find((note) => note.pitch === 60)!;
    expect(first.length).toBe(1); // default length
    expect(first.velocity).toBeCloseTo(0.8); // default velocity
  });

  it("set_parameter validates against the schema before dispatching", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    const params = (await tool("list_parameters").run({ track: trackId })) as {
      parameters: { id: string; kind: string; min?: number; max?: number }[];
    };
    const numberParam = params.parameters.find((param) => param.kind === "number" && typeof param.max === "number")!;

    await expect(
      tool("set_parameter").run({ track: trackId, id: numberParam.id, value: numberParam.min }),
    ).resolves.toMatchObject({ ok: true });
    await expect(tool("set_parameter").run({ track: trackId, id: "does-not-exist", value: 1 })).rejects.toThrow(
      /Unknown parameter/,
    );
    await expect(
      tool("set_parameter").run({ track: trackId, id: numberParam.id, value: (numberParam.max ?? 0) + 1e6 }),
    ).rejects.toThrow();
  });

  it("set_tempo updates the project tempo", async () => {
    await tool("set_tempo").run({ bpm: 128 });
    expect(store.tempo).toBe(128);
  });

  it("rename_track renames via dispatch", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive", name: "old" })) as {
      trackId: string;
    };
    await tool("rename_track").run({ track: trackId, name: "new name" });
    expect(store.getTrack(trackId)?.name).toBe("new name");
  });

  it("mix_track sets volume through dispatch", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    await tool("mix_track").run({ track: trackId, volume: 0.5, muted: true });
    const track = store.getTrack(trackId)!;
    expect(track.volume).toBeCloseTo(0.5);
    expect(track.muted).toBe(true);
  });
});

describe("createAgentTools - effects", () => {
  it("add_effect appends to the chain and list_effects reads it back", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    const added = (await tool("add_effect").run({ track: trackId, effect: "reverb" })) as { effectId: string };

    const listed = (await tool("list_effects").run({ track: trackId })) as {
      palette: { type: string }[];
      effects: { id: string; type: string }[];
    };
    expect(listed.palette.map((entry) => entry.type)).toContain("reverb");
    expect(listed.effects).toEqual([{ id: added.effectId, type: "reverb", bypassed: false }]);
  });

  it("rejects an unknown effect type", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    await expect(tool("add_effect").run({ track: trackId, effect: "bogus" })).rejects.toThrow(/Unknown effect/);
  });

  it("set_effect_parameter validates against the effect schema", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    const { effectId } = (await tool("add_effect").run({ track: trackId, effect: "reverb" })) as { effectId: string };

    // Every effect has a `mix` param in 0..1.
    await expect(
      tool("set_effect_parameter").run({ track: trackId, effect_id: effectId, id: "mix", value: 0.25 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      tool("set_effect_parameter").run({ track: trackId, effect_id: effectId, id: "nope", value: 1 }),
    ).rejects.toThrow(/Unknown parameter/);
  });

  it("bypass_effect toggles bypass", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    const { effectId } = (await tool("add_effect").run({ track: trackId, effect: "delay" })) as { effectId: string };
    await tool("bypass_effect").run({ track: trackId, effect_id: effectId, bypassed: true });
    expect(store.getEffect(trackId, effectId)?.bypassed).toBe(true);
  });
});

describe("createAgentTools - arrangement + structure + library", () => {
  it("edit_notes moves an existing note by id", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    await tool("add_notes").run({ track: trackId, notes: [{ pitch: 60, start: 0 }] });
    const before = (await tool("list_notes").run({ track: trackId })) as { notes: { id: string }[] };
    const id = before.notes[0].id;
    await tool("edit_notes").run({ track: trackId, notes: [{ id, pitch: 67, start: 2, length: 1 }] });
    const after = (await tool("list_notes").run({ track: trackId })) as {
      notes: { id: string; pitch: number; start: number }[];
    };
    expect(after.notes).toHaveLength(1);
    expect(after.notes[0]).toMatchObject({ id, pitch: 67, start: 2 });
  });

  it("add_clip adds to the pool and list_clips reads it back", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    const before = (await tool("list_clips").run({ track: trackId })) as { clips: unknown[] };
    const added = (await tool("add_clip").run({ track: trackId, name: "B" })) as { clipId: string };
    const after = (await tool("list_clips").run({ track: trackId })) as { clips: { id: string; name: string }[] };
    expect(after.clips.length).toBe(before.clips.length + 1);
    expect(after.clips.some((clip) => clip.id === added.clipId && clip.name === "B")).toBe(true);
  });

  it("add_placement lays a clip on the timeline", async () => {
    const { trackId } = (await tool("create_track").run({ instrument: "subtractive" })) as { trackId: string };
    const placed = (await tool("add_placement").run({ track: trackId, start_beat: 4 })) as { placementId: string };
    const listed = (await tool("list_placements").run({ track: trackId })) as {
      placements: { id: string; startBeat: number }[];
    };
    expect(listed.placements.some((p) => p.id === placed.placementId && p.startBeat === 4)).toBe(true);
  });

  it("create_group shows up in list_groups", async () => {
    const created = (await tool("create_group").run({ name: "Drums" })) as { groupId: string };
    const listed = (await tool("list_groups").run({})) as { groups: { id: string; name: string }[] };
    expect(listed.groups.some((group) => group.id === created.groupId && group.name === "Drums")).toBe(true);
  });

  it("list_samples exposes the built-in kit as refs", async () => {
    const result = (await tool("list_samples").run({})) as { builtin: { ref: string }[] };
    expect(result.builtin.length).toBeGreaterThan(0);
    expect(result.builtin.every((entry) => entry.ref.startsWith("builtin:"))).toBe(true);
  });

  it("apply_patch creates a track from a factory patch", async () => {
    const patches = (await tool("list_patches").run({})) as { patches: { name: string; builtin: boolean }[] };
    const factory = patches.patches.find((patch) => patch.builtin)!;
    const applied = (await tool("apply_patch").run({ patch: factory.name })) as { trackId: string };
    expect(store.getTrack(applied.trackId)?.kind).toBe("instrument");
  });

  it("set_groove rejects an unknown groove", async () => {
    await expect(tool("set_groove").run({ groove: "nonsense" })).rejects.toThrow(/Unknown groove/);
    await expect(tool("set_groove").run({ amount: 0.5 })).resolves.toMatchObject({ ok: true });
  });
});
