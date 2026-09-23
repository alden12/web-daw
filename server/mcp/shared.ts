/**
 * What every group of MCP tools shares: id minters, the device-format document, and the text
 * result shapes. Pure data and helpers, with no project or transport in sight.
 */
import { VOCABULARY, NODE_KINDS } from "../../src/audio/graph/vocabulary";
import { INSTRUMENT_RESERVED, EFFECT_RESERVED } from "../../src/audio/graph/validate";

export const randomId = () => crypto.randomUUID();
export const makeTrackId = () => `t-${randomId().slice(0, 8)}`;
export const makeGroupId = () => `g-${randomId().slice(0, 8)}`;
export const makeEffectId = () => `fx-${randomId().slice(0, 8)}`;
export const makeMidiDeviceId = () => `md-${randomId().slice(0, 8)}`;
export const makeClipId = () => `c-${randomId().slice(0, 8)}`;
export const makePlacementId = () => `p-${randomId().slice(0, 8)}`;
export const makeCustomInstrumentId = () => `ci-${randomId().slice(0, 8)}`;
export const makeCustomEffectId = () => `ce-${randomId().slice(0, 8)}`;

/** The declarative device format, as data the AI can read before authoring one. */
export const deviceFormatDoc = () => ({
  overview:
    "A custom instrument is { label?, schema, voice }; a custom effect is { label?, schema, graph }. " +
    "`schema` is the parameter list (the keystone - drives UI/automation/persistence). `voice`/`graph` is a node graph. " +
    "Include amp.level + env.attack + env.release in an instrument schema for level/envelope control; include `mix` in an effect schema for dry/wet.",
  nodeKinds: NODE_KINDS.map((kind) => ({
    kind,
    audioParams: VOCABULARY[kind].audioParams,
    properties: VOCABULARY[kind].properties,
  })),
  reserved: { instrument: INSTRUMENT_RESERVED, effect: EFFECT_RESERVED },
  binding:
    "A node field is a literal, or { param: <schema id>, scale?, offset? } to bind it (value = param*scale + offset). Enum fields (waveform, filterType) are a literal string or a param.",
  connection:
    "[from, to]; `to` is a node id (audio input) or `nodeId.param` to modulate that AudioParam. Reserved ids are the amp/in/wet endpoints above.",
  oscFrequency:
    "An osc tracks the played note by default; `noteRatio` multiplies the note (FM/sub-oscillator); `frequency` sets an absolute Hz (an LFO).",
  example: {
    label: "My Synth",
    schema: [
      {
        id: "filter.cutoff",
        label: "Cutoff",
        kind: "number",
        min: 20,
        max: 20000,
        default: 4000,
        taper: "exponential",
      },
      { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
      { id: "env.attack", label: "Attack", kind: "number", min: 1, max: 2000, default: 5, unit: "ms" },
      { id: "env.release", label: "Release", kind: "number", min: 1, max: 4000, default: 200, unit: "ms" },
    ],
    voice: {
      nodes: [
        { id: "osc", kind: "osc", waveform: "sawtooth" },
        { id: "filter", kind: "biquad", filterType: "lowpass", frequency: { param: "filter.cutoff" } },
      ],
      connections: [
        ["osc", "filter"],
        ["filter", "amp"],
      ],
    },
  },
});

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
