import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { instrumentInfos } from "../src/audio/instruments/catalog";

describe("ProjectStore", () => {
  it("seeds one subtractive track by default and selects it", () => {
    const p = new ProjectStore();
    const s = p.getStructure();
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].instrumentType).toBe("subtractive");
    expect(s.selectedTrackId).toBe(s.tracks[0].id);
  });

  it("can start empty (server mirror) with seedDefault=false", () => {
    expect(new ProjectStore(false).getStructure().tracks).toHaveLength(0);
  });

  it("adds tracks of different instrument types, each with its own schema", () => {
    const p = new ProjectStore(false);
    const sub = p.addTrack("subtractive");
    const fm = p.addTrack("fm");
    expect(sub.params.spec("filter.cutoff")).toBeTruthy();
    expect(fm.params.spec("fm.ratio")).toBeTruthy();
    // FM has no filter param
    expect(() => fm.params.spec("filter.cutoff")).toThrow();
    expect(p.getStructure().tracks).toHaveLength(2);
  });

  it("honors an explicit id and is idempotent on re-add (sync from the other end)", () => {
    const p = new ProjectStore(false);
    const a = p.addTrack("fm", { name: "Bass", id: "t-abc" });
    const b = p.addTrack("fm", { name: "Bass", id: "t-abc" });
    expect(a).toBe(b);
    expect(p.getStructure().tracks).toHaveLength(1);
  });

  it("falls back to the default instrument for unknown types", () => {
    const t = new ProjectStore(false).addTrack("nope");
    expect(t.instrumentType).toBe("subtractive");
  });

  it("removes tracks and reselects", () => {
    const p = new ProjectStore(false);
    const a = p.addTrack("subtractive");
    const b = p.addTrack("fm");
    expect(p.selectedId).toBe(b.id);
    p.removeTrack(b.id);
    expect(p.selectedId).toBe(a.id);
    p.removeTrack(a.id);
    expect(p.selectedId).toBeNull();
  });

  it("sets mute, volume (clamped), and tempo (clamped)", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    p.setMuted(t.id, true);
    expect(p.getTrack(t.id)!.muted).toBe(true);
    p.setVolume(t.id, 5);
    expect(p.getTrack(t.id)!.volume).toBe(1);
    p.setTempo(9999);
    expect(p.tempo).toBe(300);
  });

  it("round-trips snapshot and load (multiple tracks, params, clips)", () => {
    const a = new ProjectStore(false);
    const t1 = a.addTrack("subtractive", { name: "Lead" });
    t1.params.set("filter.cutoff", 1234);
    a.getClipStore(t1.id)!.addNote({ pitch: 60, start: 0 });
    const t2 = a.addTrack("fm", { name: "Bass" });
    t2.params.set("fm.ratio", 3);
    a.setTempo(100);
    const snap = a.snapshot();

    const b = new ProjectStore(false);
    b.load(snap);
    expect(b.getStructure().tracks.map((t) => t.name)).toEqual(["Lead", "Bass"]);
    expect(b.tempo).toBe(100);
    const lead = b.getTrack(t1.id)!;
    expect(lead.params.get("filter.cutoff")).toBe(1234);
    expect(b.getClipStore(t1.id)!.getClip().notes).toHaveLength(1);
    expect(b.getTrack(t2.id)!.params.get("fm.ratio")).toBe(3);
  });

  it("adds, reorders, bypasses, and removes effects, each with its own schema", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    const delay = p.addEffect(t.id, "delay")!;
    const reverb = p.addEffect(t.id, "reverb")!;
    expect(p.getStructure().tracks[0].effects.map((fx) => fx.type)).toEqual(["delay", "reverb"]);
    // each effect has its own ParamStore over the effect's schema
    expect(delay.params.spec("delay.feedback")).toBeTruthy();
    expect(reverb.params.spec("reverb.decay")).toBeTruthy();
    expect(() => delay.params.spec("reverb.decay")).toThrow();

    // reorder: move reverb to the front
    p.moveEffect(t.id, reverb.id, 0);
    expect(p.getStructure().tracks[0].effects.map((fx) => fx.id)).toEqual([reverb.id, delay.id]);

    // bypass
    p.setEffectBypass(t.id, delay.id, true);
    expect(p.getEffect(t.id, delay.id)!.bypassed).toBe(true);

    // remove
    p.removeEffect(t.id, reverb.id);
    expect(p.getStructure().tracks[0].effects.map((fx) => fx.id)).toEqual([delay.id]);
  });

  it("falls back to the default effect for unknown types and is idempotent on re-add", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    const fx = p.addEffect(t.id, "nope")!;
    expect(fx.type).toBe("delay");
    const again = p.addEffect(t.id, "delay", fx.id);
    expect(again).toBe(fx);
    expect(p.getTrack(t.id)!.effects).toHaveLength(1);
  });

  it("round-trips effects (type, bypass, params) through snapshot/load", () => {
    const a = new ProjectStore(false);
    const t = a.addTrack("subtractive", { name: "Pad" });
    const rev = a.addEffect(t.id, "reverb")!;
    rev.params.set("mix", 0.6);
    a.addEffect(t.id, "delay");
    a.setEffectBypass(t.id, rev.id, true);
    const snap = a.snapshot();

    const b = new ProjectStore(false);
    b.load(snap);
    const effects = b.getTrack(t.id)!.effects;
    expect(effects.map((fx) => fx.type)).toEqual(["reverb", "delay"]);
    expect(effects[0].bypassed).toBe(true);
    expect(effects[0].params.get("mix")).toBe(0.6);
  });
});

describe("ProjectStore groups (bus tree)", () => {
  it("files new tracks into the single default 'main' group, creating it once", () => {
    const p = new ProjectStore(false);
    const sub = p.addTrack("subtractive");
    const groups = p.getGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("main");
    expect(groups[0].parentId).toBeNull();
    expect(sub.parentId).toBe(groups[0].id);

    // every kind of track reuses the same "main" group (no more per-family groups)
    const sub2 = p.addTrack("subtractive");
    expect(sub2.parentId).toBe(groups[0].id);
    const fm = p.addTrack("fm");
    expect(p.getGroups()).toHaveLength(1);
    expect(fm.parentId).toBe(groups[0].id);
  });

  it("seeds the default project with one track filed into a group", () => {
    const p = new ProjectStore();
    expect(p.getGroups()).toHaveLength(1);
    expect(p.getStructure().tracks[0].parentId).toBe(p.getGroups()[0].id);
  });

  it("moves a track into another group and nests groups, rejecting cycles", () => {
    const p = new ProjectStore(false);
    const drums = p.addGroup({ name: "Drums" });
    const bus = p.addGroup({ name: "Bus" });
    const t = p.addTrack("subtractive");
    p.moveTrack(t.id, drums.id);
    expect(p.getTrack(t.id)!.parentId).toBe(drums.id);

    p.moveGroup(drums.id, bus.id);
    expect(p.getGroup(drums.id)!.parentId).toBe(bus.id);
    // cycle: bus cannot become a child of its own descendant
    p.moveGroup(bus.id, drums.id);
    expect(p.getGroup(bus.id)!.parentId).toBeNull();
    // self-parenting is a no-op
    p.moveGroup(bus.id, bus.id);
    expect(p.getGroup(bus.id)!.parentId).toBeNull();
  });

  it("removeGroup cascades: deletes descendant subgroups and their tracks", () => {
    const p = new ProjectStore(false);
    const parent = p.addGroup({ name: "Parent" });
    const child = p.addGroup({ name: "Child", parentId: parent.id });
    const t1 = p.addTrack("subtractive", { groupId: parent.id });
    const t2 = p.addTrack("fm", { groupId: child.id });

    p.removeGroup(parent.id);
    expect(p.getGroups()).toHaveLength(0);
    expect(p.getTrack(t1.id)).toBeUndefined();
    expect(p.getTrack(t2.id)).toBeUndefined();
  });

  it("hosts an effect chain on a group bus (host-addressed effects)", () => {
    const p = new ProjectStore(false);
    const g = p.addGroup({ name: "Bus" });
    const fx = p.addEffect(g.id, "reverb")!;
    expect(p.getGroup(g.id)!.effects.map((e) => e.type)).toEqual(["reverb"]);
    expect(p.getEffect(g.id, fx.id)).toBe(fx);
    expect(p.getStructure().groups[0].effects[0].type).toBe("reverb");
    p.removeEffect(g.id, fx.id);
    expect(p.getGroup(g.id)!.effects).toHaveLength(0);
  });

  it("round-trips the group tree through snapshot/load", () => {
    const a = new ProjectStore(false);
    const g = a.addGroup({ name: "Keys" });
    a.addEffect(g.id, "delay");
    const t = a.addTrack("subtractive", { name: "Pad", groupId: g.id });
    const snap = a.snapshot();

    const b = new ProjectStore(false);
    b.load(snap);
    const grp = b.getGroups().find((x) => x.name === "Keys")!;
    expect(grp).toBeTruthy();
    expect(grp.effects.map((e) => e.type)).toEqual(["delay"]);
    expect(b.getTrack(t.id)!.parentId).toBe(grp.id);
  });

  it("migrates a legacy flat snapshot by filing tracks into the main group", () => {
    const legacy = {
      tracks: [
        {
          id: "t-1",
          name: "Lead",
          instrumentType: "subtractive",
          muted: false,
          volume: 0.8,
          params: {},
          clip: { lengthBeats: 16, notes: [] },
          effects: [],
        },
        {
          id: "t-2",
          name: "Sub",
          instrumentType: "fm",
          muted: false,
          volume: 0.8,
          params: {},
          clip: { lengthBeats: 16, notes: [] },
          effects: [],
        },
      ],
      tempoBpm: 120,
      lengthBeats: 16,
      selectedTrackId: "t-1",
    } as unknown as Parameters<ProjectStore["load"]>[0];

    const p = new ProjectStore(false);
    p.load(legacy);
    expect(p.getStructure().tracks).toHaveLength(2);
    // both tracks were filed into the single "main" group
    expect(p.getGroup(p.getTrack("t-1")!.parentId)!.name).toBe("main");
    expect(p.getTrack("t-2")!.parentId).toBe(p.getTrack("t-1")!.parentId);
  });
});

describe("ProjectStore audio tracks", () => {
  it("adds an audio track filed into the main group, with a clip + placement", () => {
    const p = new ProjectStore(false);
    const t = p.addAudioTrack({ fileId: "au-xyz", name: "Take 1", durationSec: 3.5 });
    expect(t.kind).toBe("audio");
    expect(t.clips[0].fileId).toBe("au-xyz");
    expect(t.clips[0].durationSec).toBe(3.5);
    expect(t.placements[0].startBeat).toBe(0);
    const group = p.getGroup(t.parentId)!;
    expect(group.name).toBe("main");
    expect(group.parentId).toBeNull();
  });

  it("records a take into an existing audio track (clip pool + placement, active)", () => {
    const p = new ProjectStore(false);
    const t = p.addAudioTrack({ fileId: "au-1", name: "Vox", durationSec: 1 });
    p.setTempo(120); // 2 beats/sec, so 2s -> 4 beats
    p.addAudioClip({
      trackId: t.id,
      id: "c-take",
      placementId: "p-take",
      fileId: "au-2",
      name: "Take 2",
      durationSec: 2,
      startBeat: 8,
    });
    const got = p.getTrack(t.id)!;
    expect(got.clips.map((c) => c.id)).toEqual([`c-${t.id}`, "c-take"]);
    expect(got.activeClipId).toBe("c-take");
    const placement = got.placements.find((pl) => pl.id === "p-take")!;
    expect(placement.clipId).toBe("c-take");
    expect(placement.startBeat).toBe(8);
    expect(placement.length).toBe(4); // 2s at 120bpm
  });

  it("addAudioClip is idempotent on the clip id (safe to replay) and no-ops on instrument tracks", () => {
    const p = new ProjectStore(false);
    const t = p.addAudioTrack({ fileId: "au-1" });
    const spec = { trackId: t.id, id: "c-dup", placementId: "p-dup", fileId: "au-2", durationSec: 1 };
    p.addAudioClip(spec);
    p.addAudioClip(spec); // replay: no duplicate clip/placement
    const got = p.getTrack(t.id)!;
    expect(got.clips.filter((c) => c.id === "c-dup")).toHaveLength(1);
    expect(got.placements.filter((pl) => pl.id === "p-dup")).toHaveLength(1);
    const inst = p.addTrack(instrumentInfos()[0].type);
    p.addAudioClip({ trackId: inst.id, id: "c-x", placementId: "p-x", fileId: "au-3" });
    expect((p.getTrack(inst.id) as { clips: unknown[] }).clips.some((c) => (c as { id: string }).id === "c-x")).toBe(
      false,
    );
  });

  it("audio tracks carry an effect chain like instrument tracks", () => {
    const p = new ProjectStore(false);
    const t = p.addAudioTrack({ fileId: "au-1" });
    const fx = p.addEffect(t.id, "reverb")!;
    expect(p.getTrack(t.id)!.effects.map((e) => e.type)).toEqual(["reverb"]);
    expect(p.getEffect(t.id, fx.id)).toBe(fx);
  });

  it("edits clip gain (boost clamped to 4x) and placement start beat; ignores instrument tracks", () => {
    const p = new ProjectStore(false);
    const audio = p.addAudioTrack({ fileId: "au-1" });
    p.setAudioClip(audio.id, undefined, { gain: 5 });
    p.movePlacement(audio.id, audio.placements[0].id, 2);
    const t = p.getTrack(audio.id) as { clips: { gain: number }[]; placements: { startBeat: number }[] };
    expect(t.clips[0].gain).toBe(4); // boost allowed, clamped to 4x
    p.setAudioClip(audio.id, undefined, { gain: 1.8 });
    expect((p.getTrack(audio.id) as { clips: { gain: number }[] }).clips[0].gain).toBe(1.8);
    expect(t.placements[0].startBeat).toBe(2);
    // no-op on an instrument track
    const inst = p.addTrack("subtractive");
    expect(() => p.setAudioClip(inst.id, undefined, { gain: 0.5 })).not.toThrow();
  });

  it("sets a clip loop region in seconds, clamped inside the clip with a min span", () => {
    const p = new ProjectStore(false);
    const audio = p.addAudioTrack({ fileId: "au-1", durationSec: 4 });
    const get = () => p.getTrack(audio.id)!.clips[0] as { loopStartSec?: number; loopEndSec?: number };
    p.setAudioClip(audio.id, undefined, { loopStartSec: 1, loopEndSec: 3 });
    expect(get().loopStartSec).toBe(1);
    expect(get().loopEndSec).toBe(3);
    // end clamps inside the clip duration
    p.setAudioClip(audio.id, undefined, { loopEndSec: 99 });
    expect(get().loopEndSec).toBe(4);
    // start cannot cross the end (keeps a minimum span)
    p.setAudioClip(audio.id, undefined, { loopStartSec: 99 });
    expect(get().loopStartSec!).toBeLessThan(get().loopEndSec!);
  });

  it("slides an audio clip under the grid (gridOffsetSec set, clamped to ±duration, round-trips)", () => {
    const p = new ProjectStore(false);
    const audio = p.addAudioTrack({ fileId: "au-1", durationSec: 4 });
    const get = () => p.getTrack(audio.id)!.clips[0] as { gridOffsetSec?: number };
    p.setAudioClip(audio.id, undefined, { gridOffsetSec: 0.5 });
    expect(get().gridOffsetSec).toBe(0.5);
    // negative slide (audio earlier) is allowed
    p.setAudioClip(audio.id, undefined, { gridOffsetSec: -0.75 });
    expect(get().gridOffsetSec).toBe(-0.75);
    // cannot slide further than the clip length in either direction
    p.setAudioClip(audio.id, undefined, { gridOffsetSec: 99 });
    expect(get().gridOffsetSec).toBe(4);
    p.setAudioClip(audio.id, undefined, { gridOffsetSec: -99 });
    expect(get().gridOffsetSec).toBe(-4);
    // survives a snapshot/load round-trip
    const b = new ProjectStore(false);
    b.load(p.snapshot());
    expect((b.getTrack(audio.id)!.clips[0] as { gridOffsetSec?: number }).gridOffsetSec).toBe(-4);
  });

  it("round-trips a mixed instrument + audio project through snapshot/load", () => {
    const a = new ProjectStore(false);
    a.addTrack("subtractive", { name: "Lead" });
    const au = a.addAudioTrack({ fileId: "au-9", name: "Vox", durationSec: 2, startBeat: 4, gain: 0.7 });
    a.addEffect(au.id, "delay");
    const snap = a.snapshot();

    const b = new ProjectStore(false);
    b.load(snap);
    const structure = b.getStructure();
    expect(structure.tracks.map((t) => t.kind)).toEqual(["instrument", "audio"]);
    const loaded = b.getTrack(au.id)!;
    expect(loaded.kind).toBe("audio");
    if (loaded.kind === "audio") {
      expect(loaded.clips[0].fileId).toBe("au-9");
      expect(loaded.clips[0].gain).toBe(0.7);
      expect(loaded.placements[0].startBeat).toBe(4);
    }
    expect(loaded.effects.map((e) => e.type)).toEqual(["delay"]);
  });
});

describe("addNoteClip (recorded MIDI take)", () => {
  const lane = (p: ProjectStore, trackId: string) => p.getStructure().tracks.find((t) => t.id === trackId)!.placements;

  it("adds a clip with its notes and places it at the given beat", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    p.addNoteClip({
      trackId: t.id,
      id: "c-take",
      placementId: "p-take",
      name: "Take 1",
      notes: [{ id: "n1", pitch: 60, start: 0, length: 1, velocity: 0.8 }],
      lengthBeats: 4,
      startBeat: 8,
    });
    const placements = lane(p, t.id);
    const placed = placements.find((pl) => pl.id === "p-take")!;
    expect(placed.clipId).toBe("c-take");
    expect(placed.startBeat).toBe(8);
    expect(placed.length).toBe(4);
    expect(p.getClipStore(t.id, "c-take")!.getClip().notes).toHaveLength(1);
    // The recorded clip becomes the active one.
    expect(p.getStructure().tracks.find((x) => x.id === t.id)!.activeClipId).toBe("c-take");
  });

  it("is a no-op on a non-instrument track and ignores a duplicate clip id", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    p.addNoteClip({ trackId: t.id, id: "c-dup", placementId: "p-a", notes: [], lengthBeats: 4, startBeat: 0 });
    p.addNoteClip({ trackId: t.id, id: "c-dup", placementId: "p-b", notes: [], lengthBeats: 4, startBeat: 0 });
    expect(lane(p, t.id).filter((pl) => pl.clipId === "c-dup")).toHaveLength(1);
  });

  it("punches in: drops a fully covered placement, keeps a disjoint one", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    p.addPlacement(t.id, { id: "p-old", startBeat: 0, length: 4 }); // covered by [0,4)
    p.addPlacement(t.id, { id: "p-far", startBeat: 8, length: 4 }); // disjoint
    p.addNoteClip({ trackId: t.id, id: "c-take", placementId: "p-take", notes: [], lengthBeats: 4, startBeat: 0 });
    const ids = lane(p, t.id).map((pl) => pl.id);
    expect(ids).toContain("p-far");
    expect(ids).toContain("p-take");
    expect(ids).not.toContain("p-old");
  });

  it("punches in: trims a placement that straddles an edge", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    p.addPlacement(t.id, { id: "p-left", startBeat: 0, length: 6 }); // overlaps left edge of [4,8)
    p.addNoteClip({ trackId: t.id, id: "c-take", placementId: "p-take", notes: [], lengthBeats: 4, startBeat: 4 });
    const left = lane(p, t.id).find((pl) => pl.id === "p-left")!;
    expect(left.startBeat).toBe(0);
    expect(left.length).toBe(4); // trimmed back to the take's start
  });

  it("punches in: splits a placement that spans the whole take, keeping both remnants", () => {
    const p = new ProjectStore(false);
    const t = p.addTrack("subtractive");
    p.addPlacement(t.id, { id: "p-big", clipId: undefined, startBeat: 0, offset: 0, length: 12 });
    p.addNoteClip({ trackId: t.id, id: "c-take", placementId: "p-take", notes: [], lengthBeats: 4, startBeat: 4 });
    const placements = lane(p, t.id);
    const left = placements.find((pl) => pl.id === "p-big")!;
    expect(left.startBeat).toBe(0);
    expect(left.length).toBe(4); // [0,4)
    const right = placements.find((pl) => pl.id === "p-take-r-p-big")!;
    expect(right.startBeat).toBe(8); // [8,12)
    expect(right.length).toBe(4);
    expect(right.offset).toBe(8); // window advanced past the punched-out region
  });
});

describe("instrument catalog", () => {
  it("exposes a label and a valid schema for every instrument type", () => {
    for (const def of instrumentInfos()) {
      expect(def.label).toBeTruthy();
      expect(def.schema.length).toBeGreaterThan(0);
      for (const spec of def.schema) {
        expect(spec.id).toBeTruthy();
        if (spec.kind === "number") expect(spec.min).toBeLessThanOrEqual(spec.max);
      }
      expect(def.type).toBeTruthy();
    }
  });
});
