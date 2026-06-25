/**
 * The instrument catalog: pure data (labels + parameter schemas), no audio/DOM.
 * This is what the ProjectStore and the Node MCP server consume to build param
 * stores and describe instruments. The audio factories live in registry.ts
 * (DOM); keeping them apart lets the server type-check without Web Audio types.
 *
 * Instruments are *registered*, not hardcoded: built-ins self-register at the
 * bottom of this file, and `registerInstrument` is the extension point an
 * add-on (eventually a plugin package) calls to contribute a new instrument
 * without editing the core. Because the parameter schema is the keystone, a
 * registered instrument appears in the UI, the MCP palette, automation, and
 * persistence automatically. (Runtime registration trades the old compile-time
 * "every cataloged type has a factory" check for external extensibility; the
 * factory half lives in registry.ts and is registered alongside.)
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

export const supersawSchema: ParamSchema = [
  { id: 'super.voices', label: 'Voices', kind: 'number', min: 1, max: 9, default: 7, taper: 'linear' },
  { id: 'super.detune', label: 'Detune', kind: 'number', min: 0, max: 100, default: 25, unit: 'cents', taper: 'linear' },
  { id: 'amp.level', label: 'Level', kind: 'number', min: 0, max: 1, default: 0.7, taper: 'linear', smoothMs: 10 },
  { id: 'env.attack', label: 'Attack', kind: 'number', min: 1, max: 2000, default: 8, unit: 'ms', taper: 'exponential' },
  { id: 'env.release', label: 'Release', kind: 'number', min: 1, max: 4000, default: 300, unit: 'ms', taper: 'exponential' },
] as const;

export const organSchema: ParamSchema = [
  { id: 'organ.brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 0.5, taper: 'linear' },
  { id: 'amp.level', label: 'Level', kind: 'number', min: 0, max: 1, default: 0.7, taper: 'linear', smoothMs: 10 },
  { id: 'env.attack', label: 'Attack', kind: 'number', min: 1, max: 2000, default: 10, unit: 'ms', taper: 'exponential' },
  { id: 'env.release', label: 'Release', kind: 'number', min: 1, max: 4000, default: 120, unit: 'ms', taper: 'exponential' },
] as const;

// Morphing wavetable synth (AudioWorklet). Param ids match the processor's AudioParam
// names so WorkletInstrument binds them generically; smoothMs keeps the morph zipper-free.
export const wavetableSchema: ParamSchema = [
  { id: 'wt.position', label: 'Position', kind: 'number', min: 0, max: 1, default: 0, taper: 'linear', smoothMs: 20 },
  { id: 'wt.tone', label: 'Tone', kind: 'number', min: 0, max: 1, default: 0.6, taper: 'linear', smoothMs: 20 },
  { id: 'amp.level', label: 'Level', kind: 'number', min: 0, max: 1, default: 0.7, taper: 'linear', smoothMs: 10 },
  { id: 'env.attack', label: 'Attack', kind: 'number', min: 1, max: 2000, default: 8, unit: 'ms', taper: 'exponential' },
  { id: 'env.release', label: 'Release', kind: 'number', min: 1, max: 4000, default: 300, unit: 'ms', taper: 'exponential' },
] as const;

export interface InstrumentInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
  /**
   * Default group family a new track of this instrument is filed into (the
   * "Claude is the librarian" rule - organization is maintained as music is
   * built, not patched up later). Just a sensible default; tracks can be moved.
   */
  family: string;
}

/** The instrument data registry (insertion order = catalog/palette order). */
const REGISTRY = new Map<string, InstrumentInfo>();

/** Register an instrument's data (label + schema + family). The audio factory is
 *  registered separately in registry.ts, so this stays DOM-free for the server. */
export function registerInstrument(info: InstrumentInfo): void {
  REGISTRY.set(info.type, info);
}

/** Every registered instrument, in registration order (iterate this, never hardcode). */
export function instrumentInfos(): InstrumentInfo[] {
  return [...REGISTRY.values()];
}

/** Whether an instrument type is registered. */
export function hasInstrument(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_INSTRUMENT = 'subtractive';

/** The entry for a type, falling back to the default for unknown ids. */
export function catalogEntry(type: string): InstrumentInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_INSTRUMENT)!;
}

export function instrumentSchema(type: string): ParamSchema {
  return catalogEntry(type).schema;
}

/** Default group family for an instrument type (see InstrumentInfo.family). */
export function instrumentFamily(type: string): string {
  return catalogEntry(type).family;
}

// --- built-in instruments (self-registered) -------------------------------
registerInstrument({ type: 'subtractive', label: 'Subtractive', schema: subtractiveSchema, family: 'Synths' });
registerInstrument({ type: 'fm', label: 'FM', schema: fmSchema, family: 'Bass' });
registerInstrument({ type: 'supersaw', label: 'Supersaw', schema: supersawSchema, family: 'Synths' });
registerInstrument({ type: 'organ', label: 'Organ', schema: organSchema, family: 'Keys' });
registerInstrument({ type: 'wavetable', label: 'Wavetable', schema: wavetableSchema, family: 'Synths' });
