/**
 * Shared polyphonic voice machinery for instruments. Subclasses define the
 * per-voice audio graph (createVoice), any shared nodes (buildGraph), and their
 * parameter bindings (buildBindings); the base owns the voice pool, the
 * amplitude envelope (attack/release + velocity), and time-aware
 * noteOn/noteOff/playNote/allNotesOff.
 */
import type { ParamStore } from "../params/store";
import type { Instrument, VoiceHandle } from "./types";
import { bindParams, rampParam, type ParamBinding } from "./binding";

export abstract class BaseInstrument implements Instrument {
  protected readonly ctx: BaseAudioContext;
  protected readonly store: ParamStore;
  /** Instrument output (its amp.level gain); connect into the track gain. */
  readonly output: GainNode;

  private readonly active = new Set<VoiceHandle>();
  private readonly held = new Map<number, VoiceHandle>();
  private readonly releasing = new WeakSet<VoiceHandle>();
  protected readonly env = { attackMs: 5, releaseMs: 200 };

  private unsubscribe: (() => void) | null = null;

  constructor(ctx: BaseAudioContext, store: ParamStore) {
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
  protected init(): void {
    this.buildGraph();
    this.unsubscribe = bindParams(this.store, this.buildBindings());
  }

  /** Build any shared nodes that feed `output` (e.g. a filter). */
  protected abstract buildGraph(): void;
  /** Param id -> binding. Subclasses usually spread `commonBindings()`. */
  protected abstract buildBindings(): Record<string, ParamBinding>;
  /** Build + connect + tune a voice (sources not started; base starts it). */
  protected abstract createVoice(midi: number, when: number): VoiceHandle;

  /** amp.level (output gain) + envelope times - shared by every instrument. */
  protected commonBindings(): Record<string, ParamBinding> {
    return {
      "amp.level": { apply: (v, ms) => rampParam(this.ctx, this.output.gain, v as number, ms) },
      "env.attack": { apply: (v) => void (this.env.attackMs = v as number) },
      "env.release": { apply: (v) => void (this.env.releaseMs = v as number) },
    };
  }

  /** Currently sounding voices (for subclasses that poke live voices). */
  protected get voices(): Iterable<VoiceHandle> {
    return this.active;
  }

  private startVoice(voice: VoiceHandle, velocity: number, when: number): void {
    const attack = this.env.attackMs / 1000;
    const g = voice.amp.gain;
    const level = Math.max(0.0001, velocity);
    voice.level = level;
    voice.attackStart = when;
    voice.attackEnd = when + attack;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(level, when + attack);
    for (const source of voice.sources) source.start(when);
    this.active.add(voice);
    voice.sources[0].onended = () => {
      this.active.delete(voice);
      for (const source of voice.sources) source.disconnect();
      voice.amp.disconnect();
    };
  }

  private releaseVoice(voice: VoiceHandle, when: number): void {
    if (this.releasing.has(voice)) return;
    this.releasing.add(voice);
    const at = Math.max(when, this.ctx.currentTime);
    const release = this.env.releaseMs / 1000;
    const g = voice.amp.gain;
    // Anchor the gain at its true value at `at` (mid-attack or full sustain), then ramp to 0.
    // We compute the held value ourselves rather than calling cancelAndHoldAtTime, whose Chrome
    // bug makes the following linearRamp start from the wrong value - an instant step to ~0 that
    // clicks the moment a note is released. Explicit setValueAtTime + ramp is jump-free.
    const level = voice.level ?? g.value;
    const attackStart = voice.attackStart ?? at;
    const attackEnd = voice.attackEnd ?? at;
    const heldLevel =
      at <= attackStart ? 0 : at >= attackEnd ? level : level * ((at - attackStart) / (attackEnd - attackStart));
    g.cancelScheduledValues(at);
    g.setValueAtTime(heldLevel, at);
    g.linearRampToValueAtTime(0, at + release);
    for (const source of voice.sources) source.stop(at + release + 0.02);
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
