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
    "Include amp.level in an instrument schema for its level; include `mix` in an effect schema for dry/wet.",
  nodeKinds: NODE_KINDS.map((kind) => ({
    kind,
    summary: VOCABULARY[kind].summary,
    audioParams: VOCABULARY[kind].audioParams,
    properties: VOCABULARY[kind].properties,
  })),
  reserved: { instrument: INSTRUMENT_RESERVED, effect: EFFECT_RESERVED },
  binding:
    "A node field is a literal, or { param: <schema id>, scale?, offset? } to bind it (value = param*scale + offset). Enum fields (waveform, filterType) are a literal string or a param. " +
    "A number field's binding can also take `table`: [[paramValue, fieldValue], ...] with ascending paramValues, which the param is read off first " +
    "(straight lines between points, the end values beyond them), then scale/offset apply. Use it for a non-linear knob: a curve " +
    "(sample it at 10-20 points), or a step per value of a whole-number param, e.g. a level of 0 until a count reaches 3.",
  connection:
    "[from, to]; `to` is a node id (audio input) or `nodeId.param` to modulate that AudioParam. Reserved ids are the endpoints above.",
  voiceOutput:
    "An instrument voice ends at `amp` or `out`, never both. `amp` applies a built-in attack/release envelope " +
    "(params env.attack + env.release, in ms). `out` passes the voice through as-is, for a voice that shapes its own " +
    "amplitude with an `env` into a VCA gain - use it for plucks, pads, anything that needs decay and sustain.",
  envelopes:
    "An `env` node (instruments only) is an ADSR control signal: 0 -> 1 over attack, down to sustain over decay, " +
    "held while the note is, then to 0 over release. Fields attack/decay/release are ms, sustain is 0..1; each is a " +
    "literal or a param. It has no input; wire it like an LFO: into `vca.gain` (a gain with gain: 0) to shape amplitude, " +
    "or through a gain that sets its depth into any `.param` - `filter.detune` (cents) for a filter sweep in musical " +
    "intervals, `osc.detune` for a pitch drop, an FM depth gain's `.gain` for a brightness envelope. Use as many as you like.",
  oscFrequency:
    "An osc tracks the played note by default; `noteRatio` multiplies the note (FM/sub-oscillator); `frequency` sets an absolute Hz (an LFO).",
  example: {
    label: "Pluck",
    schema: [
      {
        id: "filter.cutoff",
        label: "Cutoff",
        kind: "number",
        min: 20,
        max: 20000,
        default: 400,
        taper: "exponential",
      },
      { id: "filter.env", label: "Filter Env", kind: "number", min: 0, max: 48, default: 36, unit: "st" },
      { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
      { id: "env.decay", label: "Decay", kind: "number", min: 1, max: 4000, default: 400, unit: "ms" },
      { id: "env.release", label: "Release", kind: "number", min: 1, max: 4000, default: 300, unit: "ms" },
    ],
    voice: {
      nodes: [
        { id: "osc", kind: "osc", waveform: "sawtooth" },
        { id: "filter", kind: "biquad", filterType: "lowpass", frequency: { param: "filter.cutoff" } },
        { id: "filterEnv", kind: "env", attack: 2, decay: 250, sustain: 0 },
        { id: "filterDepth", kind: "gain", gain: { param: "filter.env", scale: 100 } },
        {
          id: "ampEnv",
          kind: "env",
          attack: 2,
          decay: { param: "env.decay" },
          sustain: 0,
          release: { param: "env.release" },
        },
        { id: "vca", kind: "gain", gain: 0 },
      ],
      connections: [
        ["osc", "filter"],
        ["filter", "vca"],
        ["filterEnv", "filterDepth"],
        ["filterDepth", "filter.detune"],
        ["ampEnv", "vca.gain"],
        ["vca", "out"],
      ],
    },
  },
});

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
