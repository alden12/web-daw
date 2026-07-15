/**
 * An effect driven by a declarative graph (types.ts) instead of hand-written code.
 * It reuses BaseEffect for the wet/dry `mix` crossfade: the graph is built once over
 * the reserved `in` (effect input) and `wet` (processed bus) endpoints, its source
 * oscillators (e.g. an LFO) are started here and stopped on teardown, and parameter
 * changes are pushed into the live graph.
 */
import type { ParamStore } from "../params/store";
import type { ParamBinding } from "../params/binding";
import { BaseEffect } from "../effects/BaseEffect";
import { buildGraph, collectParamIds, type BuiltGraph } from "./build";
import type { GraphEffectDef } from "./types";

export class GraphEffect extends BaseEffect {
  private readonly def: GraphEffectDef;
  private built!: BuiltGraph;

  constructor(ctx: AudioContext, store: ParamStore, def: GraphEffectDef) {
    super(ctx, store);
    this.def = def;
    this.init();
  }

  protected buildGraph(): void {
    this.built = buildGraph(this.def.graph, {
      ctx: this.ctx,
      reserved: { in: this.input, wet: this.wet },
      readParam: (id) => this.store.get(id),
    });
    for (const source of this.built.sources) source.start();
  }

  protected buildBindings(): Record<string, ParamBinding> {
    const bindings: Record<string, ParamBinding> = { ...this.commonBindings() };
    for (const id of collectParamIds(this.def.graph)) {
      bindings[id] = { apply: (value, smoothMs) => this.built.apply(id, value, smoothMs) };
    }
    return bindings;
  }

  protected teardown(): void {
    for (const source of this.built.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.built.disconnect();
  }
}
