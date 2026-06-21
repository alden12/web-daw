/**
 * Effect factories (the audio side; uses Web Audio). The AudioEngine calls
 * createEffect to realize a track's chain. Pure catalog data (labels/schemas)
 * lives in catalog.ts so non-audio consumers (ProjectStore, MCP server) stay
 * DOM-free.
 */
import type { ParamStore } from '../params/store';
import type { Effect } from './types';
import { DelayEffect } from './Delay';
import { DistortionEffect } from './Distortion';
import { ReverbEffect } from './Reverb';
import { FilterEffect } from './Filter';
import { DEFAULT_EFFECT } from './catalog';

type EffectFactory = (ctx: AudioContext, store: ParamStore) => Effect;

const FACTORIES: Record<string, EffectFactory> = {
  delay: (ctx, store) => new DelayEffect(ctx, store),
  distortion: (ctx, store) => new DistortionEffect(ctx, store),
  reverb: (ctx, store) => new ReverbEffect(ctx, store),
  filter: (ctx, store) => new FilterEffect(ctx, store),
};

export function createEffect(type: string, ctx: AudioContext, store: ParamStore): Effect {
  const make = FACTORIES[type] ?? FACTORIES[DEFAULT_EFFECT];
  return make(ctx, store);
}

export { EFFECT_CATALOG, EFFECT_TYPES, effectSchema, effectCatalogEntry, DEFAULT_EFFECT } from './catalog';
