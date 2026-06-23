/**
 * The effect catalog: pure data (labels + parameter schemas), no audio/DOM.
 * Mirrors instruments/catalog.ts so the ProjectStore and the Node MCP server can
 * consume effect schemas without Web Audio types. Audio factories live in
 * registry.ts (DOM). Every effect schema includes a uniform `mix` (wet/dry).
 */
import type { ParamSchema } from '../params/types';

export const delaySchema: ParamSchema = [
  { id: 'delay.time', label: 'Time', kind: 'number', min: 0.01, max: 1.5, default: 0.3, unit: 's', taper: 'linear', smoothMs: 60 },
  { id: 'delay.feedback', label: 'Feedback', kind: 'number', min: 0, max: 0.95, default: 0.35, taper: 'linear', smoothMs: 20 },
  { id: 'mix', label: 'Mix', kind: 'number', min: 0, max: 1, default: 0.3, taper: 'linear', smoothMs: 20 },
] as const;

export const distortionSchema: ParamSchema = [
  { id: 'dist.drive', label: 'Drive', kind: 'number', min: 1, max: 100, default: 20, taper: 'exponential', smoothMs: 20 },
  { id: 'dist.tone', label: 'Tone', kind: 'number', min: 200, max: 12000, default: 6000, unit: 'Hz', taper: 'exponential', smoothMs: 20 },
  { id: 'mix', label: 'Mix', kind: 'number', min: 0, max: 1, default: 1, taper: 'linear', smoothMs: 20 },
] as const;

export const reverbSchema: ParamSchema = [
  { id: 'reverb.decay', label: 'Decay', kind: 'number', min: 0.1, max: 6, default: 2, unit: 's', taper: 'exponential' },
  { id: 'mix', label: 'Mix', kind: 'number', min: 0, max: 1, default: 0.3, taper: 'linear', smoothMs: 20 },
] as const;

export const filterSchema: ParamSchema = [
  { id: 'filter.cutoff', label: 'Cutoff', kind: 'number', min: 20, max: 18000, default: 2000, unit: 'Hz', taper: 'exponential', smoothMs: 15 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'number', min: 0.0001, max: 24, default: 6, unit: 'Q', taper: 'linear', smoothMs: 15 },
  { id: 'lfo.rate', label: 'LFO Rate', kind: 'number', min: 0.05, max: 20, default: 1, unit: 'Hz', taper: 'exponential', smoothMs: 20 },
  { id: 'lfo.depth', label: 'LFO Depth', kind: 'number', min: 0, max: 1, default: 0.5, taper: 'linear', smoothMs: 20 },
  { id: 'mix', label: 'Mix', kind: 'number', min: 0, max: 1, default: 1, taper: 'linear', smoothMs: 20 },
] as const;

export interface EffectCatalogEntry {
  label: string;
  schema: ParamSchema;
}

export const EFFECT_CATALOG = {
  delay: { label: 'Delay', schema: delaySchema },
  distortion: { label: 'Distortion', schema: distortionSchema },
  reverb: { label: 'Reverb', schema: reverbSchema },
  filter: { label: 'Filter', schema: filterSchema },
} satisfies Record<string, EffectCatalogEntry>;

/** Cataloged effect ids. The registry is typed off this, so every type has a factory. */
export type EffectType = keyof typeof EFFECT_CATALOG;

/** Display/insertion order for add buttons and the MCP palette (derived, never drifts). */
export const EFFECT_TYPES = Object.keys(EFFECT_CATALOG) as EffectType[];

export const DEFAULT_EFFECT: EffectType = 'delay';

// Lenient string-keyed view for callers holding an untyped id (persistence, MCP).
const byType: Record<string, EffectCatalogEntry> = EFFECT_CATALOG;

export function effectCatalogEntry(type: string): EffectCatalogEntry {
  return byType[type] ?? byType[DEFAULT_EFFECT];
}

export function effectSchema(type: string): ParamSchema {
  return effectCatalogEntry(type).schema;
}
