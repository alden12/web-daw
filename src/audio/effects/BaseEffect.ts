/**
 * Shared machinery for effects: the wet/dry routing and the param-binding seam.
 * The base wires `input -> dry -> output` and `wet -> output`; the subclass's
 * buildGraph() wires its processing from `this.input` into `this.wet`. The
 * uniform `mix` param crossfades dry/wet. Subclasses define buildGraph() and
 * buildBindings() (usually spreading commonBindings()).
 */
import type { ParamStore } from '../params/store';
import { bindParams, rampParam, type ParamBinding } from '../params/binding';
import type { Effect } from './types';

export abstract class BaseEffect implements Effect {
  protected readonly ctx: AudioContext;
  protected readonly store: ParamStore;
  readonly input: GainNode;
  readonly output: GainNode;
  /** Subclass writes its processed signal into `wet`; `dry` is the bypass-of-mix path. */
  protected readonly wet: GainNode;
  protected readonly dry: GainNode;

  private unsubscribe: (() => void) | null = null;

  constructor(ctx: AudioContext, store: ParamStore) {
    this.ctx = ctx;
    this.store = store;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }

  /**
   * Must be called by the subclass constructor AFTER super() and its own field
   * initializers (same useDefineForClassFields field-clobber reason documented on
   * BaseInstrument.init). buildGraph() reads subclass fields that don't exist yet
   * if called from the base constructor.
   */
  protected init(): void {
    this.buildGraph();
    this.unsubscribe = bindParams(this.store, this.buildBindings());
  }

  /** Wire the wet processing: read from `this.input`, end at `this.wet`. */
  protected abstract buildGraph(): void;
  protected abstract buildBindings(): Record<string, ParamBinding>;

  /** The `mix` crossfade (dry = 1-mix, wet = mix) - shared by every effect. */
  protected commonBindings(): Record<string, ParamBinding> {
    return {
      mix: {
        apply: (v, ms) => {
          const m = v as number;
          rampParam(this.ctx, this.wet.gain, m, ms);
          rampParam(this.ctx, this.dry.gain, 1 - m, ms);
        },
      },
    };
  }

  /** Subclass hook to stop oscillators / disconnect internal nodes. */
  protected teardown(): void {}

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.teardown();
    this.input.disconnect();
    this.dry.disconnect();
    this.wet.disconnect();
    this.output.disconnect();
  }
}
