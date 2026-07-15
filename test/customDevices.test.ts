import { describe, it, expect } from "vitest";
import { parseCustomDevices, DEVICE_FORMAT_VERSION } from "../src/audio/graph/zod";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { hasInstrument, instrumentSchema } from "../src/audio/instruments/catalog";
import type { GraphInstrumentDef } from "../src/audio/graph/types";

const validInstrument: GraphInstrumentDef = {
  type: "ci-test",
  label: "Test Synth",
  schema: [
    { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
    { id: "osc.detune", label: "Detune", kind: "number", min: -100, max: 100, default: 0 },
  ],
  voice: {
    nodes: [{ id: "osc", kind: "osc", waveform: "sawtooth", detune: { param: "osc.detune" } }],
    connections: [["osc", "amp"]],
  },
};

describe("parseCustomDevices (untrusted-input gate)", () => {
  it("keeps a valid instrument def", () => {
    const { instruments } = parseCustomDevices({
      customInstruments: [validInstrument],
      deviceFormatVersion: DEVICE_FORMAT_VERSION,
    });
    expect(instruments).toHaveLength(1);
    expect(instruments[0].type).toBe("ci-test");
  });

  it("drops a def with a dangling connection", () => {
    const bad = { ...validInstrument, voice: { nodes: [{ id: "osc", kind: "osc" }], connections: [["osc", "ghost"]] } };
    expect(parseCustomDevices({ customInstruments: [bad] }).instruments).toHaveLength(0);
  });

  it("drops a def binding a parameter not in its schema", () => {
    const bad = {
      ...validInstrument,
      voice: { nodes: [{ id: "osc", kind: "osc", detune: { param: "nope" } }], connections: [["osc", "amp"]] },
    };
    expect(parseCustomDevices({ customInstruments: [bad] }).instruments).toHaveLength(0);
  });

  it("drops a def with an unknown node kind", () => {
    const bad = { ...validInstrument, voice: { nodes: [{ id: "x", kind: "reverbtron" }], connections: [] } };
    expect(parseCustomDevices({ customInstruments: [bad] }).instruments).toHaveLength(0);
  });

  it("ignores all custom devices on an unknown format version", () => {
    const result = parseCustomDevices({ customInstruments: [validInstrument], deviceFormatVersion: 999 });
    expect(result.instruments).toHaveLength(0);
  });
});

describe("custom devices through ProjectStore", () => {
  it("registers a custom instrument schema and round-trips it through snapshot/load", () => {
    const store = new ProjectStore();
    store.addCustomInstrument(validInstrument);
    // Its schema is registered, so a track could build a param store from it.
    expect(hasInstrument("ci-test")).toBe(true);
    expect(instrumentSchema("ci-test").some((spec) => spec.id === "osc.detune")).toBe(true);

    const snap = store.snapshot();
    expect(snap.customInstruments?.map((def) => def.type)).toContain("ci-test");
    expect(snap.deviceFormatVersion).toBe(DEVICE_FORMAT_VERSION);

    // A fresh store loading the snapshot re-registers the device.
    const reloaded = new ProjectStore();
    reloaded.load(snap);
    expect(reloaded.customInstruments.map((def) => def.type)).toContain("ci-test");
    expect(hasInstrument("ci-test")).toBe(true);

    reloaded.removeCustomInstrument("ci-test");
    expect(hasInstrument("ci-test")).toBe(false);
  });

  it("drops an invalid embedded def on load rather than throwing", () => {
    const store = new ProjectStore();
    const bad = {
      customInstruments: [{ type: "ci-bad", schema: [], voice: { nodes: [], connections: [["a", "b"]] } }],
    };
    expect(() => store.load(bad as never)).not.toThrow();
    expect(store.customInstruments).toHaveLength(0);
  });

  it("undo removes a just-added custom instrument; redo restores it", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "addCustomInstrument", def: validInstrument }, "claude");
    expect(store.customInstruments.map((def) => def.type)).toContain("ci-test");
    log.undo();
    expect(store.customInstruments.some((def) => def.type === "ci-test")).toBe(false);
    log.redo();
    expect(store.customInstruments.map((def) => def.type)).toContain("ci-test");
    store.removeCustomInstrument("ci-test"); // cleanup (registry is module-global)
  });
});
