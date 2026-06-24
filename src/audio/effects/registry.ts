/**
 * Effect factories (the audio side; uses Web Audio). The AudioEngine calls
 * createEffect to realize a track's chain. Pure catalog data (labels/schemas)
 * lives in catalog.ts so non-audio consumers (ProjectStore, MCP server) stay
 * DOM-free.
 *
 * Factories are registered, mirroring the data registry in catalog.ts:
 * `registerEffectFactory` is the audio half of the extension point.
 */
import type { ParamStore } from '../params/store';
import type { Effect } from './types';
import { DelayEffect } from './Delay';
import { DistortionEffect } from './Distortion';
import { ReverbEffect } from './Reverb';
import { FilterEffect } from './Filter';
import { ChorusEffect } from './Chorus';
import { TremoloEffect } from './Tremolo';
import { DEFAULT_EFFECT } from './catalog';

type EffectFactory = (ctx: AudioContext, store: ParamStore) => Effect;

const FACTORIES = new Map<string, EffectFactory>();

/** Register the audio factory for an effect type (pair with registerEffect). */
export function registerEffectFactory(type: string, factory: EffectFactory): void {
  FACTORIES.set(type, factory);
}

export function createEffect(type: string, ctx: AudioContext, store: ParamStore): Effect {
  const make = FACTORIES.get(type) ?? FACTORIES.get(DEFAULT_EFFECT)!;
  return make(ctx, store);
}

// --- built-in factories (self-registered) ---------------------------------
registerEffectFactory('delay', (ctx, store) => new DelayEffect(ctx, store));
registerEffectFactory('distortion', (ctx, store) => new DistortionEffect(ctx, store));
registerEffectFactory('reverb', (ctx, store) => new ReverbEffect(ctx, store));
registerEffectFactory('filter', (ctx, store) => new FilterEffect(ctx, store));
registerEffectFactory('chorus', (ctx, store) => new ChorusEffect(ctx, store));
registerEffectFactory('tremolo', (ctx, store) => new TremoloEffect(ctx, store));

export { effectInfos, effectSchema, effectCatalogEntry, hasEffect, DEFAULT_EFFECT } from './catalog';
