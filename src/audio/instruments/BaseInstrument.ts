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

/** The fade at each end of a voice that shapes its own amplitude: long enough not to click, too
 *  short to hear as an envelope. */
const DECLICK_SECONDS = 0.003;

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
    const attack = voice.envelope?.ownsAmplitude ? DECLICK_SECONDS : this.env.attackMs / 1000;
    const g = voice.amp.gain;
    const level = Math.max(0.0001, velocity);
    voice.level = level;
    voice.attackStart = when;
    voice.attackEnd = when + attack;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(level, when + attack);
    for (const source of voice.sources) source.start(when);
    this.active.add(voice);
    // Tear down once every source has ended, not the first: a short one-shot sample can end long
    // before the oscillator beside it, and taking the voice down with it would cut the note.
    let sounding = voice.sources.length;
    const ended = () => {
      sounding -= 1;
      if (sounding > 0) return;
      this.active.delete(voice);
      for (const source of voice.sources) source.disconnect();
      voice.amp.disconnect();
    };
    for (const source of voice.sources) source.onended = ended;
  }

  /**
   * Let a voice go at `when`. `stopping` is Stop, not a note ending: it cuts a one-shot short, and it
   * reaches a voice already let go whose one-shot is still playing out, where a note-off would not.
   */
  private releaseVoice(voice: VoiceHandle, when: number, stopping = false): void {
    if (this.releasing.has(voice)) {
      if (stopping) this.cutHeldVoice(voice);
      return;
    }
    this.releasing.add(voice);
    const at = Math.max(when, this.ctx.currentTime);
    // A voice with its own envelopes lets them go too. If they shape the amplitude, the fade out
    // waits for the longest of them; otherwise the base's release is what you hear, and it
    // ends the voice regardless.
    const envelopeTail = voice.envelope?.release(at) ?? 0;
    const ownsAmplitude = voice.envelope?.ownsAmplitude ?? false;
    // A one-shot sample plays out however early the note is let go, so the fade waits for it too.
    const playsUntil = stopping ? 0 : (voice.envelope?.playsUntil ?? 0);
    const fadeFrom = Math.max(ownsAmplitude ? at + envelopeTail : at, playsUntil);
    const release = ownsAmplitude ? DECLICK_SECONDS : this.env.releaseMs / 1000;
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
    if (fadeFrom > at) {
      g.setValueAtTime(heldLevel, fadeFrom);
      voice.heldAfterRelease = { level: heldLevel, until: fadeFrom };
    }
    g.linearRampToValueAtTime(0, fadeFrom + release);
    for (const source of voice.sources) source.stop(fadeFrom + release + 0.02);
  }

  /** Stop, for a voice already let go but held for its one-shot: fade it now rather than when the
   *  sample ends. One already fading is left to finish, which takes no longer than its release. */
  private cutHeldVoice(voice: VoiceHandle): void {
    const now = this.ctx.currentTime;
    const held = voice.heldAfterRelease;
    if (!held || now >= held.until) return;
    const g = voice.amp.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(held.level, now);
    g.linearRampToValueAtTime(0, now + DECLICK_SECONDS);
    for (const source of voice.sources) source.stop(now + DECLICK_SECONDS + 0.02);
    voice.heldAfterRelease = undefined;
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
    for (const voice of [...this.active]) this.releaseVoice(voice, now, true);
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
