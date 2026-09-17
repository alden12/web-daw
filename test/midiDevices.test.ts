import { describe, it, expect } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";

describe("MIDI devices in the project store", () => {
  it("adds a device, persists its params, and round-trips through snapshot/load", () => {
    const store = new ProjectStore();
    const track = store.addTrack("subtractive", { name: "Lead" });
    const device = store.addMidiDevice(track.id, "octavator");
    expect(device).toBeDefined();
    device!.params.set("octaveDown", true);
    device!.params.set("level", 0.4);

    const reloaded = new ProjectStore();
    reloaded.load(store.snapshot());
    const loaded = reloaded.getTrack(track.id);
    expect(loaded?.kind).toBe("instrument");
    const devices = loaded?.kind === "instrument" ? loaded.midiDevices : [];
    expect(devices).toHaveLength(1);
    expect(devices[0].type).toBe("octavator");
    expect(devices[0].params.get("octaveDown")).toBe(true);
    expect(devices[0].params.get("level")).toBeCloseTo(0.4);
  });

  it("removeMidiDevice drops it", () => {
    const store = new ProjectStore();
    const track = store.addTrack("subtractive");
    const device = store.addMidiDevice(track.id, "octavator")!;
    store.removeMidiDevice(track.id, device.id);
    const t = store.getTrack(track.id);
    expect(t?.kind === "instrument" && t.midiDevices).toHaveLength(0);
  });

  it("undo removes a just-added device; redo restores it", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    const track = store.addTrack("subtractive");
    log.dispatch({ type: "addMidiDevice", trackId: track.id, deviceType: "octavator", id: "md-test" }, "you");
    const has = () => {
      const t = store.getTrack(track.id);
      return t?.kind === "instrument" && t.midiDevices.some((device) => device.id === "md-test");
    };
    expect(has()).toBe(true);
    log.undo();
    expect(has()).toBe(false);
    log.redo();
    expect(has()).toBe(true);
  });

  it("rejects a MIDI device on an audio track", () => {
    const store = new ProjectStore();
    const audio = store.addAudioTrack({ fileId: "f-1", name: "Drums" });
    expect(store.addMidiDevice(audio.id, "octavator")).toBeUndefined();
  });

  it("clears the MIDI-device chain when the instrument is swapped", () => {
    const store = new ProjectStore();
    const track = store.addTrack("subtractive");
    store.addMidiDevice(track.id, "octavator");
    store.setInstrument(track.id, "fm");
    const t = store.getTrack(track.id);
    expect(t?.kind === "instrument" && t.midiDevices).toHaveLength(0);
  });

  it("carries MIDI devices through a patch (addTrackFromPatch)", () => {
    const store = new ProjectStore();
    const track = store.addTrackFromPatch({
      id: "t-patch",
      instrumentType: "subtractive",
      params: {},
      midiDevices: [{ id: "md-1", type: "octavator", bypassed: true, params: { octaveDown: true } }],
      effects: [],
    });
    const devices = track.kind === "instrument" ? track.midiDevices : [];
    expect(devices).toHaveLength(1);
    expect(devices[0].type).toBe("octavator");
    expect(devices[0].bypassed).toBe(true);
    expect(devices[0].params.get("octaveDown")).toBe(true);
  });

  it("applyPatchToTrack replaces the MIDI-device chain", () => {
    const store = new ProjectStore();
    const track = store.addTrack("subtractive");
    store.addMidiDevice(track.id, "octavator"); // pre-existing device to be replaced
    store.applyPatchToTrack({
      trackId: track.id,
      instrumentType: "subtractive",
      params: {},
      midiDevices: [{ id: "md-new", type: "octavator", params: { level: 0.3 } }],
      effects: [],
    });
    const t = store.getTrack(track.id);
    const devices = t?.kind === "instrument" ? t.midiDevices : [];
    expect(devices.map((device) => device.id)).toEqual(["md-new"]);
    expect(devices[0].params.get("level")).toBeCloseTo(0.3);
  });
});
