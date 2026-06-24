/**
 * Instrument factories (the audio side; uses Web Audio). The AudioEngine calls
 * createInstrument to realize a track. Pure catalog data (labels/schemas) lives
 * in catalog.ts so non-audio consumers (ProjectStore, MCP server) stay DOM-free.
 *
 * Factories are registered, mirroring the data registry in catalog.ts: a built-in
 * registers its schema (catalog.ts) and its factory (here); an external add-on
 * does the same two calls. `registerInstrumentFactory` is the audio half of the
 * extension point.
 */
import type { ParamStore } from '../params/store';
import type { Instrument } from './types';
import { SubtractiveInstrument } from './Subtractive';
import { FmInstrument } from './Fm';
import { SupersawInstrument } from './Supersaw';
import { OrganInstrument } from './Organ';
import { DEFAULT_INSTRUMENT } from './catalog';

type InstrumentFactory = (ctx: AudioContext, store: ParamStore) => Instrument;

const FACTORIES = new Map<string, InstrumentFactory>();

/** Register the audio factory for an instrument type (pair with registerInstrument). */
export function registerInstrumentFactory(type: string, factory: InstrumentFactory): void {
  FACTORIES.set(type, factory);
}

export function createInstrument(type: string, ctx: AudioContext, store: ParamStore): Instrument {
  const make = FACTORIES.get(type) ?? FACTORIES.get(DEFAULT_INSTRUMENT)!;
  return make(ctx, store);
}

// --- built-in factories (self-registered) ---------------------------------
registerInstrumentFactory('subtractive', (ctx, store) => new SubtractiveInstrument(ctx, store));
registerInstrumentFactory('fm', (ctx, store) => new FmInstrument(ctx, store));
registerInstrumentFactory('supersaw', (ctx, store) => new SupersawInstrument(ctx, store));
registerInstrumentFactory('organ', (ctx, store) => new OrganInstrument(ctx, store));

export { instrumentInfos, instrumentSchema, catalogEntry, hasInstrument, DEFAULT_INSTRUMENT } from './catalog';
