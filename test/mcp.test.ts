import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocket } from "ws";
import { createDawMcp, type DawMcp } from "../server/mcpServer";

const PORT = 8799;
const URL = `ws://localhost:${PORT}`;

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("MCP server (tracks)", () => {
  let daw: DawMcp;
  let client: Client;
  let tab: WebSocket | null = null;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<TextResult> {
    return (await client.callTool({ name, arguments: args })) as TextResult;
  }
  const parse = (r: TextResult) => JSON.parse(r.content[0].text);
  const typesOf = (msgs: unknown[]) => msgs.map((m) => (m as { type: string }).type);

  async function connectTab(): Promise<unknown[]> {
    const messages: unknown[] = [];
    const socket = new WebSocket(URL);
    tab = socket;
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });
    const start = Date.now();
    while (!parse(await call("list_tracks")).connected) {
      if (Date.now() - start > 1000) throw new Error("tab not registered");
      await new Promise((r) => setTimeout(r, 10));
    }
    return messages;
  }

  /** Create a track and return its id (read back from list_tracks). */
  async function makeTrack(instrument = "subtractive"): Promise<string> {
    await call("create_track", { instrument });
    return parse(await call("list_tracks")).selectedTrackId as string;
  }

  beforeEach(async () => {
    daw = createDawMcp({ port: PORT });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([daw.server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    tab?.close();
    tab = null;
    await client.close();
    await daw.close();
  });

  it("list_tracks reports the instrument palette and starts with no tracks", async () => {
    const data = parse(await call("list_tracks"));
    expect(data.connected).toBe(false);
    expect(data.tracks).toEqual([]);
    expect(data.instruments.map((i: { id: string }) => i.id).sort()).toEqual([
      "fm",
      "nimbus",
      "organ",
      "sampler",
      "subtractive",
      "supersaw",
      "wavetable",
    ]);
  });

  it("errors a track-addressed tool when no track exists/selected", async () => {
    const res = await call("set_parameter", { id: "amp.level", value: 0.5 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no track/i);
  });

  it("create_track forwards to the tab and appears in list_tracks", async () => {
    const messages = await connectTab();
    const res = await call("create_track", { instrument: "fm", name: "Bass" });
    expect(res.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("createTrack"));
    const created = messages.find((m) => (m as { type: string }).type === "createTrack") as {
      instrumentType: string;
      id: string;
    };
    expect(created.instrumentType).toBe("fm");
    const list = parse(await call("list_tracks"));
    expect(list.tracks).toHaveLength(1);
    expect(list.tracks[0].instrument).toBe("fm");
    expect(list.selectedTrackId).toBe(created.id);
  });

  it("rejects an unknown instrument type", async () => {
    await connectTab();
    expect((await call("create_track", { instrument: "bogus" })).isError).toBe(true);
  });

  it("set_parameter (default selected track) forwards and validates", async () => {
    const messages = await connectTab();
    const trackId = await makeTrack("subtractive");

    const okRes = await call("set_parameter", { id: "filter.cutoff", value: 2000 });
    expect(okRes.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("setParam"));
    expect(messages).toContainEqual({ type: "setParam", trackId, id: "filter.cutoff", value: 2000 });

    expect((await call("set_parameter", { id: "filter.cutoff", value: 999999 })).isError).toBe(true);
    expect((await call("set_parameter", { id: "nope", value: 1 })).isError).toBe(true);
    // fm.ratio is not a subtractive param
    expect((await call("set_parameter", { id: "fm.ratio", value: 2 })).isError).toBe(true);
  });

  it("list_samples lists the built-in kit; set_parameter validates a sampler sample ref", async () => {
    const data = parse(await call("list_samples"));
    const builtinRefs = data.builtin.map((sample: { ref: string }) => sample.ref);
    expect(builtinRefs).toContain("builtin:kick");
    expect(builtinRefs.length).toBeGreaterThanOrEqual(5);
    expect(data.project).toEqual([]); // no imported samples yet

    const messages = await connectTab();
    const trackId = await makeTrack("sampler");

    expect((await call("set_parameter", { id: "sampler.sample", value: "builtin:clap" })).isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("setParam"));
    expect(messages).toContainEqual({ type: "setParam", trackId, id: "sampler.sample", value: "builtin:clap" });
    // an imported-asset ref shape is also accepted
    expect((await call("set_parameter", { id: "sampler.sample", value: "asset:smp-1234" })).isError).toBeFalsy();
    // a bare string is not a valid tagged sample ref
    expect((await call("set_parameter", { id: "sampler.sample", value: "garbage" })).isError).toBe(true);
  });

  it("add_note / add_notes / clear_clip target the selected track", async () => {
    const messages = await connectTab();
    const trackId = await makeTrack("subtractive");

    await call("add_note", { pitch: 60, start: 0, length: 1 });
    await waitFor(() => typesOf(messages).includes("addNote"));
    const added = messages.find((m) => (m as { type: string }).type === "addNote") as { trackId: string };
    expect(added.trackId).toBe(trackId);

    await call("add_notes", {
      notes: [
        { pitch: 64, start: 1 },
        { pitch: 67, start: 2 },
      ],
    });
    let notes = parse(await call("list_notes")).clip.notes;
    expect(notes).toHaveLength(3);

    await call("clear_clip");
    notes = parse(await call("list_notes")).clip.notes;
    expect(notes).toHaveLength(0);
  });

  it("quantize pulls a clip's notes to the grid and emits one editNotes", async () => {
    const messages = await connectTab();
    await makeTrack("subtractive");

    await call("add_notes", {
      notes: [
        { pitch: 60, start: 1.1, length: 0.9 },
        { pitch: 64, start: 2.05, length: 1 },
      ],
    });
    // Off-grid positions survive (the store no longer force-snaps).
    let notes = parse(await call("list_notes")).clip.notes;
    expect(notes.find((n: { pitch: number }) => n.pitch === 60).start).toBeCloseTo(1.1);

    const res = await call("quantize", { grid: "1/4", strength: 1 });
    expect(res.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("editNotes"));

    notes = parse(await call("list_notes")).clip.notes;
    expect(notes.find((n: { pitch: number }) => n.pitch === 60).start).toBeCloseTo(1.0);
    expect(notes.find((n: { pitch: number }) => n.pitch === 64).start).toBeCloseTo(2.0);
  });

  it("add_note can target a specific track id", async () => {
    await connectTab();
    const a = await makeTrack("subtractive");
    const b = await makeTrack("fm"); // b is now selected
    await call("add_note", { track: a, pitch: 48, start: 0 });
    const aNotes = parse(await call("list_notes", { track: a })).clip.notes;
    const bNotes = parse(await call("list_notes", { track: b })).clip.notes;
    expect(aNotes).toHaveLength(1);
    expect(bNotes).toHaveLength(0);
  });

  it("add_clip + add_placement build the clip pool and arrangement (mirror updates)", async () => {
    await connectTab();
    await makeTrack("subtractive");

    // Pool seeds one clip + one placement.
    expect(parse(await call("list_clips")).clips).toHaveLength(1);
    expect(parse(await call("list_placements")).placements).toHaveLength(1);

    // Add a clip -> two; the new one is active.
    await call("add_clip", {});
    const clips = parse(await call("list_clips"));
    expect(clips.clips).toHaveLength(2);
    expect(clips.activeClipId).toBe(clips.clips[1].id);

    // Place the active clip at beat 8 -> two placements.
    await call("add_placement", { start_beat: 8 });
    const placements = parse(await call("list_placements")).placements;
    expect(placements).toHaveLength(2);
    expect(placements.some((p: { startBeat: number }) => p.startBeat === 8)).toBe(true);
  });

  it("set_tempo (project-level) forwards and updates the mirror", async () => {
    const messages = await connectTab();
    await makeTrack();
    await call("set_tempo", { bpm: 90 });
    await waitFor(() => typesOf(messages).includes("setTempo"));
    expect(parse(await call("list_tracks")).tempoBpm).toBe(90);
  });

  it("set_groove forwards and updates the mirror; list_grooves reports it", async () => {
    const messages = await connectTab();
    await makeTrack();
    await call("set_groove", { groove: "8th-58", amount: 0.5 });
    await waitFor(() => typesOf(messages).includes("setGroove"));
    const grooves = parse(await call("list_grooves"));
    expect(grooves.current).toEqual({ id: "8th-58", amount: 0.5 });
    expect(grooves.grooves.map((g: { id: string }) => g.id)).toContain("straight");
    // bad id is rejected by the enum schema
    expect((await call("set_groove", { groove: "nope" })).isError).toBe(true);
  });

  it("play / stop forward transport commands", async () => {
    const messages = await connectTab();
    await call("play");
    await call("stop");
    await waitFor(() => typesOf(messages).filter((t) => t === "transport").length === 2);
    expect(messages.filter((m) => (m as { type: string }).type === "transport")).toEqual([
      { type: "transport", action: "play" },
      { type: "transport", action: "stop" },
    ]);
  });

  it("note_off requires a midi pitch", async () => {
    await connectTab();
    await makeTrack();
    const bad = await call("note_off", {}).catch(
      (e: unknown): TextResult => ({ isError: true, content: [{ type: "text", text: String(e) }] }),
    );
    expect(bad.isError).toBe(true);
    expect((await call("note_off", { midi: 60 })).isError).toBeFalsy();
  });

  it("add_effect (default selected track) forwards and appears in list_effects", async () => {
    const messages = await connectTab();
    const trackId = await makeTrack("subtractive");

    const res = await call("add_effect", { effect: "reverb" });
    expect(res.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("addEffect"));
    const added = messages.find((m) => (m as { type: string }).type === "addEffect") as {
      hostId: string;
      effectType: string;
      id: string;
    };
    expect(added.hostId).toBe(trackId);
    expect(added.effectType).toBe("reverb");

    const list = parse(await call("list_effects"));
    expect(list.effects).toHaveLength(1);
    expect(list.effects[0].type).toBe("reverb");
    expect(list.available.map((e: { id: string }) => e.id).sort()).toEqual([
      "bitcrusher",
      "chorus",
      "delay",
      "distortion",
      "filter",
      "reverb",
      "tremolo",
    ]);
  });

  it("rejects an unknown effect type", async () => {
    await connectTab();
    await makeTrack("subtractive");
    expect((await call("add_effect", { effect: "bogus" })).isError).toBe(true);
  });

  it("set_effect_parameter forwards with track + effect id and validates", async () => {
    const messages = await connectTab();
    const trackId = await makeTrack("subtractive");
    await call("add_effect", { effect: "reverb" });
    const effectId = parse(await call("list_effects")).effects[0].id as string;

    const okRes = await call("set_effect_parameter", { effect_id: effectId, id: "mix", value: 0.5 });
    expect(okRes.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("setEffectParam"));
    expect(messages).toContainEqual({ type: "setEffectParam", hostId: trackId, effectId, id: "mix", value: 0.5 });

    expect((await call("set_effect_parameter", { effect_id: effectId, id: "mix", value: 9 })).isError).toBe(true);
    expect((await call("set_effect_parameter", { effect_id: effectId, id: "nope", value: 1 })).isError).toBe(true);
    expect((await call("set_effect_parameter", { effect_id: "fx-nope", id: "mix", value: 0.5 })).isError).toBe(true);
  });

  it("bypass / move / remove effect forward and update list_effects", async () => {
    const messages = await connectTab();
    await makeTrack("subtractive");
    await call("add_effect", { effect: "delay" });
    await call("add_effect", { effect: "reverb" });
    let list = parse(await call("list_effects"));
    const [delayId, reverbId] = list.effects.map((e: { id: string }) => e.id);

    await call("move_effect", { effect_id: reverbId, to_index: 0 });
    await call("bypass_effect", { effect_id: delayId, bypassed: true });
    await call("remove_effect", { effect_id: reverbId });
    await waitFor(() => typesOf(messages).includes("removeEffect"));

    list = parse(await call("list_effects"));
    expect(list.effects).toHaveLength(1);
    expect(list.effects[0].id).toBe(delayId);
    expect(list.effects[0].bypassed).toBe(true);
  });

  it("create_track files a track into its instrument family group (librarian)", async () => {
    const messages = await connectTab();
    await call("create_track", { instrument: "subtractive" });
    await waitFor(() => typesOf(messages).includes("createTrack"));
    // the family group was created and forwarded before the track
    expect(typesOf(messages)).toContain("createGroup");
    const groups = parse(await call("list_groups")).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Synths");
    expect(groups[0].parent).toBeNull();
    const track = parse(await call("list_tracks")).tracks[0];
    expect(track.group).toBe(groups[0].id);
    expect(groups[0].tracks).toEqual([track.id]);
  });

  it("create_group + move_track forward and update the mirror", async () => {
    const messages = await connectTab();
    const trackId = await makeTrack("subtractive"); // creates a "Synths" group
    const res = await call("create_group", { name: "Drums" });
    expect(res.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).filter((t) => t === "createGroup").length >= 2);
    const drums = parse(await call("list_groups")).groups.find((g: { name: string }) => g.name === "Drums");
    expect(drums).toBeTruthy();

    await call("move_track", { track: trackId, group: drums.id });
    await waitFor(() => typesOf(messages).includes("moveTrack"));
    expect(parse(await call("list_tracks")).tracks[0].group).toBe(drums.id);
  });

  it("add_effect targets a group bus when `group` is given", async () => {
    const messages = await connectTab();
    await makeTrack("subtractive");
    const groupId = parse(await call("list_groups")).groups[0].id as string;

    const res = await call("add_effect", { group: groupId, effect: "reverb" });
    expect(res.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("addEffect"));
    const added = messages.find((m) => (m as { type: string }).type === "addEffect") as { hostId: string };
    expect(added.hostId).toBe(groupId);
    const list = parse(await call("list_effects", { group: groupId }));
    expect(list.host).toBe(groupId);
    expect(list.effects[0].type).toBe("reverb");
  });

  // The real bridge answers history RPCs from the tab's VersionStore. Here we stub
  // the tab end: reply to each historyRequest with a canned result so we can test
  // the server's request/reply plumbing and tool surface in isolation.
  function answerHistory(replyFor: (method: string, params: Record<string, unknown>) => unknown): void {
    tab!.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as {
        type: string;
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };
      if (msg.type !== "historyRequest") return;
      tab!.send(
        JSON.stringify({ type: "historyReply", id: msg.id, ok: true, result: replyFor(msg.method, msg.params ?? {}) }),
      );
    });
  }

  it("commit / list_history / diff / revert_to round-trip to the tab", async () => {
    await connectTab();
    answerHistory((method, params) => {
      const replies: Record<string, unknown> = {
        commit: { id: "cm-1234", message: params.message, author: "claude", time: 0, auto: false, entryCount: 3 },
        history: [{ id: "cm-1234", message: "Set tempo", author: "claude", time: 0, auto: false, entryCount: 3 }],
        diff: ["tempo 120 -> 140", 'added track "Bass"'],
        revert: {
          id: "cm-5678",
          message: 'Revert to "Set tempo"',
          author: "claude",
          time: 0,
          auto: false,
          entryCount: 0,
        },
      };
      return replies[method];
    });

    const committed = await call("commit", { message: "Set tempo" });
    expect(committed.isError).toBeFalsy();
    expect(committed.content[0].text).toContain("cm-1234");
    expect(committed.content[0].text).toContain("Set tempo");

    const history = parse(await call("list_history"));
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("cm-1234");

    const diff = await call("diff", { to: "cm-1234" });
    expect(diff.content[0].text).toContain("tempo 120 -> 140");
    expect(diff.content[0].text).toContain('added track "Bass"');

    const reverted = await call("revert_to", { commit: "cm-1234" });
    expect(reverted.content[0].text).toContain("cm-5678");
  });

  it("commit reports when there is nothing to commit", async () => {
    await connectTab();
    answerHistory(() => null); // VersionStore.commit returns null on a no-op
    const res = await call("commit", { message: "noop" });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/nothing to commit/i);
  });

  it("history tools fail cleanly when no tab is connected", async () => {
    const res = await call("commit", { message: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no daw tab connected/i);
  });

  it("note posts a feed annotation to the tab", async () => {
    const messages = await connectTab();
    const res = await call("note", { text: "building the demo" });
    expect(res.isError).toBeFalsy();
    await waitFor(() => typesOf(messages).includes("note"));
    expect(messages).toContainEqual({ type: "note", text: "building the demo" });
  });

  it("note fails cleanly when no tab is connected", async () => {
    const res = await call("note", { text: "hi" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no daw tab connected/i);
  });

  // Patches live in the tab's localStorage; stub the tab end to reply to each
  // patchRequest so we can test the server's plumbing and tool surface in isolation.
  function answerPatch(replyFor: (method: string, params: Record<string, unknown>) => unknown): void {
    tab!.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as {
        type: string;
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };
      if (msg.type !== "patchRequest") return;
      tab!.send(
        JSON.stringify({ type: "patchReply", id: msg.id, ok: true, result: replyFor(msg.method, msg.params ?? {}) }),
      );
    });
  }

  it("list_patches / save_patch / apply_patch round-trip to the tab", async () => {
    await connectTab();
    answerPatch((method, params) => {
      const replies: Record<string, unknown> = {
        list: [{ id: "pt-1", name: "Warm Pad", author: "you", instrument: "subtractive", effects: ["delay"] }],
        save: { id: "pt-9", name: params.name },
        apply: { trackId: "t-new", name: params.name ?? "Warm Pad" },
      };
      return replies[method];
    });

    const list = parse(await call("list_patches"));
    expect(list[0].name).toBe("Warm Pad");
    expect(list[0].instrument).toBe("subtractive");

    const saved = await call("save_patch", { name: "My Patch" });
    expect(saved.isError).toBeFalsy();
    expect(saved.content[0].text).toContain("pt-9");
    expect(saved.content[0].text).toContain("My Patch");

    const applied = await call("apply_patch", { patch: "Warm Pad", name: "Lead" });
    expect(applied.isError).toBeFalsy();
    expect(applied.content[0].text).toContain("t-new");
    expect(applied.content[0].text).toContain("Lead");
  });

  it("patch tools fail cleanly when no tab is connected", async () => {
    expect((await call("list_patches")).isError).toBe(true);
    expect((await call("save_patch", { name: "x" })).isError).toBe(true);
    expect((await call("apply_patch", { patch: "x" })).isError).toBe(true);
  });

  it("surfaces a patch error from the tab (e.g. unknown patch)", async () => {
    await connectTab();
    tab!.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; id: string };
      if (msg.type !== "patchRequest") return;
      tab!.send(JSON.stringify({ type: "patchReply", id: msg.id, ok: false, error: 'No patch matching "ghost".' }));
    });
    const res = await call("apply_patch", { patch: "ghost" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no patch matching/i);
  });

  it("remove_group cascades and removes its tracks", async () => {
    const messages = await connectTab();
    const trackId = await makeTrack("subtractive");
    const groupId = parse(await call("list_tracks")).tracks[0].group as string;

    await call("remove_group", { group: groupId });
    await waitFor(() => typesOf(messages).includes("removeGroup"));
    expect(parse(await call("list_groups")).groups).toHaveLength(0);
    expect(parse(await call("list_tracks")).tracks.find((t: { id: string }) => t.id === trackId)).toBeUndefined();
  });
});
