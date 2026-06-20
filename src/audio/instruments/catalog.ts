/**
 * The instrument catalog: pure data (labels + parameter schemas), no audio/DOM.
 * This is what the ProjectStore and the Node MCP server consume to build param
 * stores and describe instruments. The audio factories live in registry.ts
 * (DOM); keeping them apart lets the server type-check without Web Audio types.
 */
import type { ParamSchema } from '../params/types';

export const WAVEFORMS = ['sine', 'sawtooth', 'square', 'triangle'] as const;
export type Waveform = (typeof WAVEFORMS)[number];

export const subtractiveSchema: ParamSchema = [
  { id: 'osc.waveform', label: 'Waveform', kind: 'enum', options: WAVEFORMS, default: 'sawtooth' },
  { id: 'osc.detune', label: 'Detune', kind: 'number', min: -100, max: 100, default: 0, unit: 'cents', taper: 'linear', smoothMs: 20 },
  { id: 'filter.cutoff', label: 'Cutoff', kind: 'number', min: 20, max: 20000, default: 4000, unit: 'Hz', taper: 'exponential', smoothMs: 15 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'number', min: 0.0001, max: 24, default: 1, unit: 'Q', taper: 'linear', smoothMs: 15 },
  { id: 'amp.level', label: 'Level', kind: 'number', min: 0, max: 1, default: 0.8, taper: 'linear', smoothMs: 10 },
  { id: 'env.attack', label: 'Attack', kind: 'number', min: 1, max: 2000, default: 5, unit: 'ms', taper: 'exponential' },
  { id: 'env.release', label: 'Release', kind: 'number', min: 1, max: 4000, default: 200, unit: 'ms', taper: 'exponential' },
] as const;

export const fmSchema: ParamSchema = [
  { id: 'fm.ratio', label: 'Ratio', kind: 'number', min: 0.5, max: 12, default: 2, taper: 'linear' },
  { id: 'fm.index', label: 'Index', kind: 'number', min: 0, max: 4000, default: 300, unit: 'Hz', taper: 'linear' },
  { id: 'amp.level', label: 'Level', kind: 'number', min: 0, max: 1, default: 0.8, taper: 'linear', smoothMs: 10 },
  { id: 'env.attack', label: 'Attack', kind: 'number', min: 1, max: 2000, default: 4, unit: 'ms', taper: 'exponential' },
  { id: 'env.release', label: 'Release', kind: 'number', min: 1, max: 4000, default: 250, unit: 'ms', taper: 'exponential' },
] as const;

export interface CatalogEntry {
  label: string;
  schema: ParamSchema;
}

export const INSTRUMENT_CATALOG: Record<string, CatalogEntry> = {
  subtractive: { label: 'Subtractive', schema: subtractiveSchema },
  fm: { label: 'FM', schema: fmSchema },
};

export const DEFAULT_INSTRUMENT = 'subtractive';

export function catalogEntry(type: string): CatalogEntry {
  return INSTRUMENT_CATALOG[type] ?? INSTRUMENT_CATALOG[DEFAULT_INSTRUMENT];
}

export function instrumentSchema(type: string): ParamSchema {
  return catalogEntry(type).schema;
}
