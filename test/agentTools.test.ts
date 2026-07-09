import { beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { createAgentTools } from "../src/audio/agent/tools";
import type { AgentTool } from "../src/audio/agent/types";

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
  tools = createAgentTools({ projectStore: store, dispatch: editLog.dispatch });
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
});
