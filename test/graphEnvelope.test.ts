/**
 * Envelopes in the declarative format (INST-12): the ADSR timing math, the release that anchors at
 * the envelope's true level, and the rules about where an `env` may go and how a voice goes out.
 */
import { describe, expect, it } from "vitest";
import { heldLevelAt, normalizeShape, scheduleRelease } from "../src/audio/graph/envelope";
import { validateGraph, wiresToOut, INSTRUMENT_RESERVED, EFFECT_RESERVED } from "../src/audio/graph/validate";
import { parseEffectDef, parseInstrumentDef } from "../src/audio/graph/zod";
import { subtractive } from "../src/audio/instruments/graph/subtractive";
import type { Graph } from "../src/audio/graph/types";

const shape = { attack: 0.1, decay: 0.2, sustain: 0.5 };

describe("heldLevelAt", () => {
  it("rises through the attack, falls through the decay, and holds at sustain", () => {
    expect(heldLevelAt(shape, 1, 0.5)).toBe(0); // before the note
    expect(heldLevelAt(shape, 1, 1.05)).toBeCloseTo(0.5); // halfway up the attack
    expect(heldLevelAt(shape, 1, 1.1)).toBeCloseTo(1); // the peak
    expect(heldLevelAt(shape, 1, 1.2)).toBeCloseTo(0.75); // halfway down the decay
    expect(heldLevelAt(shape, 1, 5)).toBe(0.5); // held
  });
});

describe("normalizeShape", () => {
  it("turns a zero time into a very fast ramp and keeps sustain in 0..1", () => {
    expect(normalizeShape({ attack: 0, decay: -1, sustain: 3 })).toEqual({ attack: 0.001, decay: 0.001, sustain: 1 });
  });
});

describe("scheduleRelease", () => {
  it("ramps down from where the envelope has got to, not from the peak or the sustain", () => {
    const calls: [string, number, number][] = [];
    const param = {
      cancelScheduledValues: (time: number) => calls.push(["cancel", time, 0]),
      setValueAtTime: (value: number, time: number) => calls.push(["set", value, time]),
      linearRampToValueAtTime: (value: number, time: number) => calls.push(["ramp", value, time]),
    } as unknown as AudioParam;

    // Let go halfway up the attack: the release starts from 0.5.
    scheduleRelease(param, shape, 1, 1.05, 0.3);

    expect(calls[0]).toEqual(["cancel", 1.05, 0]);
    expect(calls[1][0]).toBe("set");
    expect(calls[1][1]).toBeCloseTo(0.5);
    expect(calls[2][0]).toBe("ramp");
    expect(calls[2][1]).toBe(0);
    expect(calls[2][2]).toBeCloseTo(1.35);
  });
});

const voiceWith = (connections: [string, string][]): Graph => ({
  nodes: [
    { id: "osc", kind: "osc" },
    { id: "env", kind: "env", decay: 300, sustain: 0 },
    { id: "vca", kind: "gain", gain: 0 },
  ],
  connections,
});

describe("where an envelope may go", () => {
  it("is fine in a voice that shapes its own amplitude", () => {
    const voice = voiceWith([
      ["osc", "vca"],
      ["env", "vca.gain"],
      ["vca", "out"],
    ]);
    expect(validateGraph([], voice, INSTRUMENT_RESERVED)).toEqual([]);
    expect(wiresToOut(voice)).toBe(true);
  });

  it("is refused in an effect, which has no notes to follow", () => {
    const graph: Graph = {
      nodes: [{ id: "env", kind: "env" }],
      connections: [["in", "wet"]],
    };
    expect(validateGraph([], graph, EFFECT_RESERVED)).toEqual(['node "env": env only works in an instrument voice']);
  });

  it("refuses a voice wired to both amp and out", () => {
    const voice = voiceWith([
      ["osc", "amp"],
      ["env", "vca.gain"],
      ["vca", "out"],
    ]);
    expect(validateGraph([], voice, INSTRUMENT_RESERVED)).toEqual([
      "wire the voice to amp (the built-in envelope) or out (its own env), not both",
    ]);
  });

  it("can sweep a filter through its detune", () => {
    const voice: Graph = {
      nodes: [
        { id: "osc", kind: "osc" },
        { id: "filter", kind: "biquad" },
        { id: "env", kind: "env" },
      ],
      connections: [
        ["osc", "filter"],
        ["env", "filter.detune"],
        ["filter", "amp"],
      ],
    };
    expect(validateGraph([], voice, INSTRUMENT_RESERVED)).toEqual([]);
    expect(wiresToOut(voice)).toBe(false);
  });
});

describe("parsing an authored def with an envelope", () => {
  const voice = voiceWith([
    ["osc", "vca"],
    ["env", "vca.gain"],
    ["vca", "out"],
  ]);

  it("accepts it on an instrument", () => {
    expect(parseInstrumentDef({ schema: [], voice, type: "ci-1" }).ok).toBe(true);
  });

  it("refuses an unknown envelope field", () => {
    const bad = { ...voice, nodes: [{ id: "env", kind: "env", hold: 10 }] };
    expect(parseInstrumentDef({ schema: [], voice: bad, type: "ci-1" }).ok).toBe(false);
  });

  it("refuses it on an effect", () => {
    const graph = { nodes: [{ id: "env", kind: "env" }], connections: [["in", "wet"]] };
    expect(parseEffectDef({ schema: [], graph, type: "ce-1" }).ok).toBe(false);
  });
});

describe("the shipped Subtractive", () => {
  it("shapes its own amplitude, so it has a full ADSR", () => {
    expect(wiresToOut(subtractive.voice)).toBe(true);
  });

  it("sounds as it did before the envelopes until someone turns them", () => {
    const defaultOf = (id: string) => subtractive.schema.find((spec) => spec.id === id)?.default;
    expect(defaultOf("env.sustain")).toBe(1); // attack/release only, the old shape
    expect(defaultOf("filter.env")).toBe(0); // no sweep
  });
});
