/**
 * The effect catalog: pure data (labels + parameter schemas), no audio/DOM.
 * Mirrors instruments/catalog.ts so the ProjectStore and the Node MCP server can
 * consume effect schemas without Web Audio types. Audio factories live in
 * registry.ts (DOM). Every effect schema includes a uniform `mix` (wet/dry).
 *
 * Effects are registered, not hardcoded: built-ins self-register below and
 * `registerEffect` is the extension point for add-ons. The audio factory half is
 * registered in registry.ts.
 */
import type { ParamSchema } from "../params/types";

export const delaySchema: ParamSchema = [
  {
    id: "delay.time",
    label: "Time",
    kind: "number",
    min: 0.01,
    max: 1.5,
    default: 0.3,
    unit: "s",
    taper: "linear",
    smoothMs: 60,
  },
  {
    id: "delay.feedback",
    label: "Feedback",
    kind: "number",
    min: 0,
    max: 0.95,
    default: 0.35,
    taper: "linear",
    smoothMs: 20,
  },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear", smoothMs: 20 },
] as const;

export const distortionSchema: ParamSchema = [
  {
    id: "dist.drive",
    label: "Drive",
    kind: "number",
    min: 1,
    max: 100,
    default: 20,
    taper: "exponential",
    smoothMs: 20,
  },
  {
    id: "dist.tone",
    label: "Tone",
    kind: "number",
    min: 200,
    max: 12000,
    default: 6000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const reverbSchema: ParamSchema = [
  { id: "reverb.decay", label: "Decay", kind: "number", min: 0.1, max: 6, default: 2, unit: "s", taper: "exponential" },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear", smoothMs: 20 },
] as const;

export const filterSchema: ParamSchema = [
  {
    id: "filter.cutoff",
    label: "Cutoff",
    kind: "number",
    min: 20,
    max: 18000,
    default: 2000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 15,
  },
  {
    id: "filter.resonance",
    label: "Resonance",
    kind: "number",
    min: 0.0001,
    max: 24,
    default: 6,
    unit: "Q",
    taper: "linear",
    smoothMs: 15,
  },
  {
    id: "lfo.rate",
    label: "LFO Rate",
    kind: "number",
    min: 0.05,
    max: 20,
    default: 1,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "lfo.depth", label: "LFO Depth", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear", smoothMs: 20 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const chorusSchema: ParamSchema = [
  {
    id: "chorus.rate",
    label: "Rate",
    kind: "number",
    min: 0.05,
    max: 8,
    default: 1.2,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "chorus.depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear", smoothMs: 20 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear", smoothMs: 20 },
] as const;

export const tremoloSchema: ParamSchema = [
  {
    id: "tremolo.rate",
    label: "Rate",
    kind: "number",
    min: 0.1,
    max: 16,
    default: 4,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "tremolo.depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.6, taper: "linear", smoothMs: 20 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const bitcrusherSchema: ParamSchema = [
  {
    id: "bits",
    label: "Bits",
    kind: "number",
    min: 1,
    max: 16,
    default: 8,
    unit: "bit",
    taper: "linear",
    smoothMs: 20,
  },
  {
    id: "downsample",
    label: "Downsample",
    kind: "number",
    min: 1,
    max: 50,
    default: 4,
    unit: "×",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export interface EffectInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
}

/** The effect data registry (insertion order = palette / add-button order). */
const REGISTRY = new Map<string, EffectInfo>();

/** Register an effect's data (label + schema). The audio factory is registered
 *  separately in registry.ts, so this stays DOM-free for the server. */
export function registerEffect(info: EffectInfo): void {
  REGISTRY.set(info.type, info);
}

/** Every registered effect, in registration order (iterate this, never hardcode). */
export function effectInfos(): EffectInfo[] {
  return [...REGISTRY.values()];
}

/** Whether an effect type is registered. */
export function hasEffect(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_EFFECT = "delay";

export function effectCatalogEntry(type: string): EffectInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_EFFECT)!;
}

export function effectSchema(type: string): ParamSchema {
  return effectCatalogEntry(type).schema;
}

// --- built-in effects (self-registered) -----------------------------------
registerEffect({ type: "delay", label: "Delay", schema: delaySchema });
registerEffect({ type: "distortion", label: "Distortion", schema: distortionSchema });
registerEffect({ type: "reverb", label: "Reverb", schema: reverbSchema });
registerEffect({ type: "filter", label: "Filter", schema: filterSchema });
registerEffect({ type: "chorus", label: "Chorus", schema: chorusSchema });
registerEffect({ type: "tremolo", label: "Tremolo", schema: tremoloSchema });
registerEffect({ type: "bitcrusher", label: "Bitcrusher", schema: bitcrusherSchema });
