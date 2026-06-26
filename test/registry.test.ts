import { describe, expect, it } from "vitest";
import {
  registerInstrument,
  instrumentInfos,
  hasInstrument,
  instrumentSchema,
  instrumentFamily,
  catalogEntry,
} from "../src/audio/instruments/catalog";
import { registerInstrumentFactory, createInstrument } from "../src/audio/instruments/registry";
import { registerEffect, effectInfos, hasEffect, effectSchema } from "../src/audio/effects/catalog";
import { registerEffectFactory, createEffect } from "../src/audio/effects/registry";
import type { ParamSchema } from "../src/audio/params/types";

/**
 * The extension point: instruments and effects are registered, not hardcoded.
 * These tests exercise registration directly (the path a future plugin package
 * uses) without touching any central catalog object.
 */
describe("registration API", () => {
  it("exposes the built-ins, including the Chorus effect added via the API", () => {
    expect(instrumentInfos().map((i) => i.type)).toEqual(expect.arrayContaining(["subtractive", "fm"]));
    expect(effectInfos().map((e) => e.type)).toEqual(expect.arrayContaining(["delay", "reverb", "chorus"]));
    // Chorus is fully described by the schema keystone, mix included.
    const chorus = effectSchema("chorus");
    expect(chorus.map((s) => s.id)).toEqual(["chorus.rate", "chorus.depth", "mix"]);
  });

  it("registers a new instrument and wires it through data + factory", () => {
    const schema: ParamSchema = [{ id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.5 }];
    registerInstrument({ type: "test-pad", label: "Test Pad", schema, family: "Pads" });
    const stub = { noteOn() {}, noteOff() {}, allNotesOff() {}, output: {} as AudioNode, dispose() {} };
    registerInstrumentFactory("test-pad", () => stub);

    expect(hasInstrument("test-pad")).toBe(true);
    expect(instrumentInfos().some((i) => i.type === "test-pad")).toBe(true); // appears in the palette
    expect(instrumentSchema("test-pad")).toBe(schema);
    expect(instrumentFamily("test-pad")).toBe("Pads");
    // createInstrument dispatches to the registered factory.
    expect(createInstrument("test-pad", {} as AudioContext, {} as never)).toBe(stub);
  });

  it("registers a new effect and dispatches createEffect to its factory", () => {
    const schema: ParamSchema = [{ id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1 }];
    registerEffect({ type: "test-fx", label: "Test FX", schema });
    const stub = { input: {} as AudioNode, output: {} as AudioNode, dispose() {} };
    registerEffectFactory("test-fx", () => stub);

    expect(hasEffect("test-fx")).toBe(true);
    expect(effectInfos().some((e) => e.type === "test-fx")).toBe(true);
    expect(createEffect("test-fx", {} as AudioContext, {} as never)).toBe(stub);
  });

  it("falls back to the default for an unknown type (never throws)", () => {
    expect(hasInstrument("nope")).toBe(false);
    expect(catalogEntry("nope").type).toBe("subtractive"); // DEFAULT_INSTRUMENT
    expect(hasEffect("nope")).toBe(false);
    expect(effectSchema("nope")).toBe(effectSchema("delay")); // DEFAULT_EFFECT
  });
});
