/**
 * The declarative instrument/effect format: an instrument or effect described as
 * *data* - a small graph of curated primitive nodes plus inline parameter bindings -
 * rather than a hand-written class. The graph is interpreted at runtime (build.ts)
 * into a Web Audio node graph, driven by the same ParamStore/schema keystone as the
 * class-based instruments, so UI, MCP, automation, and persistence are unchanged.
 *
 * This is the format the AI-authored / user library will target (see DESIGN.md 16).
 * It is deliberately small: a handful of node kinds (nodes.ts), literal-or-param
 * field values with an optional linear transform, and connections that target either
 * a node's audio input or one of its AudioParams (for modulation).
 */
import type { ParamSchema } from "../params/types";

/** A parameter reference: the param value, optionally scaled/offset (value*scale + offset). */
export interface ParamRef {
  param: string;
  scale?: number;
  offset?: number;
}

/** A numeric field: a fixed value, or bound to a parameter. */
export type NumberField = number | ParamRef;
/** An enum/string field (e.g. a waveform): a fixed value, or bound to a parameter. */
export type EnumField<T extends string> = T | ParamRef;

/** An oscillator. In an instrument voice graph its frequency tracks the note by
 *  default; `noteRatio` multiplies the note (FM ratio, sub-octave); `frequency`
 *  sets an absolute Hz (an effect LFO). */
export interface OscNodeSpec {
  id: string;
  kind: "osc";
  waveform?: EnumField<OscillatorType>;
  frequency?: NumberField;
  noteRatio?: NumberField;
  detune?: NumberField;
}

export interface GainNodeSpec {
  id: string;
  kind: "gain";
  gain?: NumberField;
}

export interface BiquadNodeSpec {
  id: string;
  kind: "biquad";
  filterType?: BiquadFilterType;
  frequency?: NumberField;
  q?: NumberField;
  gain?: NumberField;
}

export interface DelayNodeSpec {
  id: string;
  kind: "delay";
  /** Maximum delay time (construction bound), seconds. */
  maxSeconds?: number;
  delayTime?: NumberField;
}

/** A named, curated waveshaper curve family (see nodes.ts `SHAPER_CURVES`). */
export type ShaperShape = "classic";

export interface ShaperNodeSpec {
  id: string;
  kind: "shaper";
  oversample?: OverSampleType;
  curve: { shape: ShaperShape; amount: NumberField };
}

export type NodeSpec = OscNodeSpec | GainNodeSpec | BiquadNodeSpec | DelayNodeSpec | ShaperNodeSpec;

/**
 * A connection `[from, to]`. `to` is a node id (connect into its audio input) or
 * `"nodeId.param"` to modulate that node's AudioParam. Reserved ids: `amp` (an
 * instrument voice's enveloped gain), `in` / `wet` (an effect's input / wet bus).
 */
export type Connection = [from: string, to: string];

export interface Graph {
  nodes: NodeSpec[];
  connections: Connection[];
}

/** An instrument as data: its schema (the keystone) + a per-voice graph. */
export interface GraphInstrumentDef {
  type: string;
  schema: ParamSchema;
  voice: Graph;
}

/** An effect as data: its schema (incl. the uniform `mix`) + a graph over `in`/`wet`. */
export interface GraphEffectDef {
  type: string;
  schema: ParamSchema;
  graph: Graph;
}
