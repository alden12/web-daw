/**
 * A polyphonic instrument driven by a declarative voice graph (types.ts) instead of
 * hand-written code. It reuses BaseInstrument for the voice pool and velocity: each note
 * builds a fresh copy of the voice graph (so it picks up the current knob values), wired
 * into the base's `amp` gain, which we connect to the instrument output. Parameter
 * changes fan out to every live voice.
 *
 * A voice wired to `amp` gets the base's attack/release envelope. One wired to `out`
 * shapes its own amplitude with `env` nodes, and the base only fades it in and out fast
 * enough not to click (INST-12). Either way its envelopes are let go with the note.
 *
 * Its samples (`buffer` nodes, INST-13) are decoded here, once per ref, not per voice: the
 * literal refs when it is built, and whatever a bound `sample` param names each time it
 * changes. `ready()` waits for them, so an offline render does not play silence.
 */
import type { ParamStore } from "../params/store";
import type { ParamBinding } from "../params/binding";
import { BaseInstrument } from "../instruments/BaseInstrument";
import type { VoiceHandle } from "../instruments/types";
import { midiToFreq } from "../instruments/binding";
import { buildGraph, collectParamIds, type BuiltGraph } from "./build";
import type { GraphInstrumentDef } from "./types";
import { wiresToOut } from "./validate";
import { loadSampleBuffer } from "../samples/builtinUrls";

export class GraphInstrument extends BaseInstrument {
  private readonly def: GraphInstrumentDef;
  private readonly paramIds: string[];
  /** Wired to `out`, so it shapes its own amplitude rather than taking the base's envelope. */
  private readonly ownsAmplitude: boolean;
  /** Per-voice live graph, so a param change can reach each sounding voice. */
  private readonly voiceGraphs = new WeakMap<VoiceHandle, BuiltGraph>();
  /** Decoded samples by ref: null while loading, or if it would not load. */
  private readonly samples = new Map<string, AudioBuffer | null>();
  private readonly loading = new Set<Promise<void>>();
  private disposed = false;

  constructor(ctx: BaseAudioContext, store: ParamStore, def: GraphInstrumentDef) {
    super(ctx, store);
    this.def = def;
    this.paramIds = collectParamIds(def.voice);
    this.ownsAmplitude = wiresToOut(def.voice);
    for (const node of def.voice.nodes) {
      if (node.kind === "buffer" && typeof node.sample === "string") this.loadSample(node.sample);
    }
    this.init();
  }

  /** The params a `buffer` node takes its sample from: changing one loads the sample it names. */
  private get sampleParams(): Set<string> {
    return new Set(
      this.def.voice.nodes.flatMap((node) =>
        node.kind === "buffer" && typeof node.sample !== "string" ? [node.sample.param] : [],
      ),
    );
  }

  private loadSample(ref: string): void {
    if (!ref || this.samples.has(ref)) return;
    this.samples.set(ref, null);
    const load = loadSampleBuffer(this.ctx, ref)
      .then((buffer) => {
        if (!this.disposed) this.samples.set(ref, buffer);
      })
      .catch(() => undefined) // a missing sample plays silence; the voice still works
      .finally(() => this.loading.delete(load));
    this.loading.add(load);
  }

  ready(): Promise<void> {
    return Promise.all([...this.loading]).then(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    super.dispose();
  }

  protected buildGraph(): void {
    // No shared nodes: everything is per-voice (see createVoice).
  }

  protected buildBindings(): Record<string, ParamBinding> {
    const bindings: Record<string, ParamBinding> = { ...this.commonBindings() };
    const sampleParams = this.sampleParams;
    for (const id of this.paramIds) {
      bindings[id] = {
        apply: (value, smoothMs) => {
          if (sampleParams.has(id)) this.loadSample(String(value));
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
      // Both endpoints are the same gain; which one the graph names decides who envelopes it.
      reserved: { amp, out: amp },
      noteFreq: midiToFreq(midi),
      startTime: when, // stamp initial values at the note's scheduled time (lookahead-safe)
      readParam: (id) => this.store.get(id),
      sampleBuffer: (ref) => this.samples.get(ref) ?? null,
    });
    amp.connect(this.output);
    const handle: VoiceHandle = {
      amp,
      sources: built.sources,
      envelope: { ownsAmplitude: this.ownsAmplitude, release: built.release, playsUntil: built.playsUntil },
    };
    this.voiceGraphs.set(handle, built);
    return handle;
  }
}
