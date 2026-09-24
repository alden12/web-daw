/**
 * Effect factories (the audio side; uses Web Audio). The AudioEngine calls
 * createEffect to realize a track's chain. Pure catalog data (labels/schemas)
 * lives in catalog.ts so non-audio consumers (ProjectStore, MCP server) stay
 * DOM-free.
 *
 * Factories are registered, mirroring the data registry in catalog.ts:
 * `registerEffectFactory` is the audio half of the extension point.
 */
import type { ParamStore } from "../params/store";
import type { Effect } from "./types";
import { GraphEffect } from "../graph/GraphEffect";
import { delay } from "./graph/delay";
import { distortion } from "./graph/distortion";
import { tremolo } from "./graph/tremolo";
import { reverb } from "./graph/reverb";
import { filter } from "./graph/filter";
import { chorus } from "./graph/chorus";
import { bitcrusher } from "./graph/bitcrusher";
import { DEFAULT_EFFECT } from "./catalog";

type EffectFactory = (ctx: BaseAudioContext, store: ParamStore) => Effect;

const FACTORIES = new Map<string, EffectFactory>();

/** Register the audio factory for an effect type (pair with registerEffect). */
export function registerEffectFactory(type: string, factory: EffectFactory): void {
  FACTORIES.set(type, factory);
}

export function createEffect(type: string, ctx: BaseAudioContext, store: ParamStore): Effect {
  const make = FACTORIES.get(type) ?? FACTORIES.get(DEFAULT_EFFECT)!;
  return make(ctx, store);
}

// --- built-in factories (self-registered) ---------------------------------
// Every effect is a declarative graph (data, not code); the Bitcrusher's is a custom-DSP block
// (INST-15). See src/audio/graph and INST-4.
registerEffectFactory(delay.type, (ctx, store) => new GraphEffect(ctx, store, delay));
registerEffectFactory(distortion.type, (ctx, store) => new GraphEffect(ctx, store, distortion));
registerEffectFactory(reverb.type, (ctx, store) => new GraphEffect(ctx, store, reverb));
registerEffectFactory(filter.type, (ctx, store) => new GraphEffect(ctx, store, filter));
registerEffectFactory(chorus.type, (ctx, store) => new GraphEffect(ctx, store, chorus));
registerEffectFactory(tremolo.type, (ctx, store) => new GraphEffect(ctx, store, tremolo));
registerEffectFactory(bitcrusher.type, (ctx, store) => new GraphEffect(ctx, store, bitcrusher));

export { effectInfos, effectSchema, effectCatalogEntry, hasEffect, DEFAULT_EFFECT } from "./catalog";
