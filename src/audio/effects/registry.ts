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
import { ReverbEffect } from "./Reverb";
import { FilterEffect } from "./Filter";
import { ChorusEffect } from "./Chorus";
import { BitcrusherEffect } from "./Bitcrusher";
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
// Delay, Distortion, and Tremolo are declarative graph effects (data, not code); the
// rest are still class-based. See src/audio/graph and DESIGN.md 16.
registerEffectFactory(delay.type, (ctx, store) => new GraphEffect(ctx, store, delay));
registerEffectFactory(distortion.type, (ctx, store) => new GraphEffect(ctx, store, distortion));
registerEffectFactory("reverb", (ctx, store) => new ReverbEffect(ctx, store));
registerEffectFactory("filter", (ctx, store) => new FilterEffect(ctx, store));
registerEffectFactory("chorus", (ctx, store) => new ChorusEffect(ctx, store));
registerEffectFactory(tremolo.type, (ctx, store) => new GraphEffect(ctx, store, tremolo));
registerEffectFactory("bitcrusher", (ctx, store) => new BitcrusherEffect(ctx, store));

export { effectInfos, effectSchema, effectCatalogEntry, hasEffect, DEFAULT_EFFECT } from "./catalog";
