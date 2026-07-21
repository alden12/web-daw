/**
 * A polyphonic instrument driven by a declarative voice graph (types.ts) instead of
 * hand-written code. It reuses BaseInstrument for the voice pool, velocity, and the
 * amp ADSR: each note builds a fresh copy of the voice graph (so it picks up the
 * current knob values), wired into the base's enveloped `amp` gain, which we connect
 * to the instrument output. Parameter changes fan out to every live voice.
 */
import type { ParamStore } from "../params/store";
import type { ParamBinding } from "../params/binding";
import { BaseInstrument } from "../instruments/BaseInstrument";
import type { VoiceHandle } from "../instruments/types";
import { midiToFreq } from "../instruments/binding";
import { buildGraph, collectParamIds, type BuiltGraph } from "./build";
import type { GraphInstrumentDef } from "./types";

export class GraphInstrument extends BaseInstrument {
  private readonly def: GraphInstrumentDef;
  private readonly paramIds: string[];
  /** Per-voice live graph, so a param change can reach each sounding voice. */
  private readonly voiceGraphs = new WeakMap<VoiceHandle, BuiltGraph>();

  constructor(ctx: BaseAudioContext, store: ParamStore, def: GraphInstrumentDef) {
    super(ctx, store);
    this.def = def;
    this.paramIds = collectParamIds(def.voice);
    this.init();
  }

  protected buildGraph(): void {
    // No shared nodes: everything is per-voice (see createVoice).
  }

  protected buildBindings(): Record<string, ParamBinding> {
    const bindings: Record<string, ParamBinding> = { ...this.commonBindings() };
    for (const id of this.paramIds) {
      bindings[id] = {
        apply: (value, smoothMs) => {
          for (const voice of this.voices) this.voiceGraphs.get(voice)?.apply(id, value, smoothMs);
        },
      };
    }
    return bindings;
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const amp = this.ctx.createGain();
    const built = buildGraph(this.def.voice, {
      ctx: this.ctx,
      reserved: { amp },
      noteFreq: midiToFreq(midi),
      startTime: when, // stamp initial values at the note's scheduled time (lookahead-safe)
      readParam: (id) => this.store.get(id),
    });
    amp.connect(this.output);
    const handle: VoiceHandle = { amp, sources: built.sources };
    this.voiceGraphs.set(handle, built);
    return handle;
  }
}
