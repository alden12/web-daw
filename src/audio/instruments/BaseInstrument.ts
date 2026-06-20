/**
 * Shared polyphonic voice machinery for instruments. Subclasses define the
 * per-voice audio graph (createVoice), any shared nodes (buildGraph), and their
 * parameter bindings (buildBindings); the base owns the voice pool, the
 * amplitude envelope (attack/release + velocity), and time-aware
 * noteOn/noteOff/playNote/allNotesOff.
 */
import type { ParamStore } from '../params/store';
import type { NumberSpec, ParamSchema } from '../params/types';
import type { Instrument, VoiceHandle } from './types';
import { rampParam, type ParamBinding } from './binding';

export abstract class BaseInstrument implements Instrument {
  protected readonly ctx: AudioContext;
  protected readonly store: ParamStore;
  /** Instrument output (its amp.level gain); connect into the track gain. */
  readonly output: GainNode;

  private readonly active = new Set<VoiceHandle>();
  private readonly held = new Map<number, VoiceHandle>();
  private readonly releasing = new WeakSet<VoiceHandle>();
  protected readonly env = { attackMs: 5, releaseMs: 200 };

  private unsubscribe: (() => void) | null = null;
  private bindings: Record<string, ParamBinding> = {};

  constructor(ctx: AudioContext, store: ParamStore) {
    this.ctx = ctx;
    this.store = store;
    this.output = ctx.createGain();
  }

  /**
   * Must be called by the subclass constructor AFTER super() and its own field
   * initializers have run. (Subclass fields initialize after super() returns, so
   * calling buildGraph/buildBindings from the base constructor would see - and
   * then have clobbered - undefined subclass fields under useDefineForClassFields.)
   */
  protected init(schema: ParamSchema): void {
    this.buildGraph();
    this.bindings = this.buildBindings();
    for (const spec of schema) this.applyParam(spec.id);
    this.unsubscribe = this.store.subscribe((id) => this.applyParam(id));
  }

  /** Build any shared nodes that feed `output` (e.g. a filter). */
  protected abstract buildGraph(): void;
  /** Param id -> binding. Subclasses usually spread `commonBindings()`. */
  protected abstract buildBindings(): Record<string, ParamBinding>;
  /** Build + connect + tune a voice (oscillators not started; base starts it). */
  protected abstract createVoice(midi: number, when: number): VoiceHandle;

  /** amp.level (output gain) + envelope times - shared by every instrument. */
  protected commonBindings(): Record<string, ParamBinding> {
    return {
      'amp.level': { apply: (v, ms) => rampParam(this.ctx, this.output.gain, v as number, ms) },
      'env.attack': { apply: (v) => void (this.env.attackMs = v as number) },
      'env.release': { apply: (v) => void (this.env.releaseMs = v as number) },
    };
  }

  /** Currently sounding voices (for subclasses that poke live voices). */
  protected get voices(): Iterable<VoiceHandle> {
    return this.active;
  }

  private applyParam(id: string): void {
    const binding = this.bindings[id];
    if (!binding) return;
    const spec = this.store.spec(id);
    const smoothMs = spec.kind === 'number' ? (spec as NumberSpec).smoothMs : undefined;
    binding.apply(this.store.get(id), smoothMs);
  }

  private startVoice(voice: VoiceHandle, velocity: number, when: number): void {
    const attack = this.env.attackMs / 1000;
    const g = voice.amp.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(Math.max(0.0001, velocity), when + attack);
    for (const osc of voice.oscillators) osc.start(when);
    this.active.add(voice);
    voice.oscillators[0].onended = () => {
      this.active.delete(voice);
      for (const osc of voice.oscillators) osc.disconnect();
      voice.amp.disconnect();
    };
  }

  private releaseVoice(voice: VoiceHandle, when: number): void {
    if (this.releasing.has(voice)) return;
    this.releasing.add(voice);
    const at = Math.max(when, this.ctx.currentTime);
    const release = this.env.releaseMs / 1000;
    const g = voice.amp.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') {
      g.cancelAndHoldAtTime(at);
    } else {
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
    }
    g.linearRampToValueAtTime(0, at + release);
    for (const osc of voice.oscillators) osc.stop(at + release + 0.02);
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    const at = when ?? this.ctx.currentTime;
    const existing = this.held.get(midi);
    if (existing) this.releaseVoice(existing, at);
    const voice = this.createVoice(midi, at);
    this.startVoice(voice, velocity, at);
    this.held.set(midi, voice);
  }

  noteOff(midi: number, when?: number): void {
    const voice = this.held.get(midi);
    if (!voice) return;
    this.held.delete(midi);
    this.releaseVoice(voice, when ?? this.ctx.currentTime);
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const at = when ?? this.ctx.currentTime;
    const voice = this.createVoice(midi, at);
    this.startVoice(voice, velocity, at);
    this.releaseVoice(voice, at + durationSec);
  }

  allNotesOff(): void {
    const now = this.ctx.currentTime;
    for (const voice of [...this.active]) this.releaseVoice(voice, now);
    this.held.clear();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.allNotesOff();
    this.active.clear();
    this.held.clear();
    this.output.disconnect();
  }
}
