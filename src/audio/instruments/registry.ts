/**
 * Instrument factories (the audio side; uses Web Audio). The AudioEngine calls
 * createInstrument to realize a track. Pure catalog data (labels/schemas) lives
 * in catalog.ts so non-audio consumers (ProjectStore, MCP server) stay DOM-free.
 */
import type { ParamStore } from '../params/store';
import type { Instrument } from './types';
import { SubtractiveInstrument } from './Subtractive';
import { FmInstrument } from './Fm';
import { DEFAULT_INSTRUMENT, type InstrumentType } from './catalog';

type InstrumentFactory = (ctx: AudioContext, store: ParamStore) => Instrument;

// Typed off the catalog keys: a cataloged instrument without a factory won't compile.
const FACTORIES: Record<InstrumentType, InstrumentFactory> = {
  subtractive: (ctx, store) => new SubtractiveInstrument(ctx, store),
  fm: (ctx, store) => new FmInstrument(ctx, store),
};

export function createInstrument(type: string, ctx: AudioContext, store: ParamStore): Instrument {
  const make = FACTORIES[type as InstrumentType] ?? FACTORIES[DEFAULT_INSTRUMENT];
  return make(ctx, store);
}

export { INSTRUMENT_CATALOG, instrumentSchema, catalogEntry, DEFAULT_INSTRUMENT } from './catalog';
