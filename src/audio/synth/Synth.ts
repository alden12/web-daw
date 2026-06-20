/**
 * The synth engine (main thread). Owns the AudioContext and the native audio
 * graph, and is the one place the parameter store is wired to audio: it
 * subscribes to the store once and routes every change through the bindings.
 *
 * Graph: per-note [OscillatorNode -> GainNode(ADSR)] -> shared BiquadFilter -> masterGain -> destination
 * Voicing: polyphonic. All voices share one filter (paraphonic filter).
 *
 * Time-aware: noteOn/noteOff/playNote accept an absolute AudioContext `when`, so
 * the lookahead scheduler can place events precisely; they default to "now" for
 * live input (keyboard / MCP).
 */
import type { ParamStore } from '../params/store';
import type { NumberSpec } from '../params/types';
import { synthSchema, type Waveform } from './schema';
import { buildBindings, type ParamBinding, type Voice, type VoiceState } from './bindings';

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class Synth {
  private ctx: AudioContext | null = null;
  private filter!: BiquadFilterNode;
  private masterGain!: GainNode;
  private bindings: Record<string, ParamBinding> = {};
  private unsubscribe: (() => void) | null = null;

  /** Every voice with a live oscillator (until it ends); used for binding pokes. */
  private readonly active = new Set<Voice>();
  /** Currently-gated notes keyed by pitch, for matching noteOff. */
  private readonly heldVoices = new Map<number, Voice>();
  /** Voices whose release is already scheduled (avoid double-release). */
  private readonly releasing = new WeakSet<Voice>();

  private readonly voiceState: VoiceState = {
    waveform: 'sawtooth',
    detune: 0,
    attackMs: 5,
    releaseMs: 200,
  };

  private readonly store: ParamStore;

  constructor(store: ParamStore) {
    this.store = store;
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  /** AudioContext time, or 0 before start. */
  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Must be called from a user gesture (click/keypress) to start the AudioContext. */
  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.masterGain = ctx.createGain();
    this.filter.connect(this.masterGain).connect(ctx.destination);

    this.bindings = buildBindings(
      ctx,
      { filter: this.filter, masterGain: this.masterGain },
      this.voiceState,
      () => this.active,
    );

    // Push current store values into the graph, then keep them in sync.
    for (const spec of synthSchema) this.applyParam(spec.id);
    this.unsubscribe = this.store.subscribe((id) => this.applyParam(id));

    await ctx.resume();
  }

  private applyParam(id: string): void {
    const binding = this.bindings[id];
    if (!binding) return;
    const spec = this.store.spec(id);
    const smoothMs = spec.kind === 'number' ? (spec as NumberSpec).smoothMs : undefined;
    binding.apply(this.store.get(id), smoothMs);
  }

  private startVoice(midi: number, velocity: number, when: number): Voice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = this.voiceState.waveform as OscillatorType;
    osc.detune.setValueAtTime(this.voiceState.detune, when);
    osc.frequency.setValueAtTime(midiToFreq(midi), when);

    const gain = ctx.createGain();
    osc.connect(gain).connect(this.filter);

    const attack = this.voiceState.attackMs / 1000;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(velocity, when + attack);

    osc.start(when);
    const voice: Voice = { osc, gain };
    this.active.add(voice);
    osc.onended = () => {
      this.active.delete(voice);
      osc.disconnect();
      gain.disconnect();
    };
    return voice;
  }

  private releaseVoice(voice: Voice, when: number): void {
    if (this.releasing.has(voice)) return;
    this.releasing.add(voice);
    const ctx = this.ctx!;
    const at = Math.max(when, ctx.currentTime);
    const release = this.voiceState.releaseMs / 1000;
    const g = voice.gain.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') {
      g.cancelAndHoldAtTime(at);
    } else {
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
    }
    g.linearRampToValueAtTime(0, at + release);
    voice.osc.stop(at + release + 0.02);
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = when ?? ctx.currentTime;
    const existing = this.heldVoices.get(midi);
    if (existing) this.releaseVoice(existing, at);
    this.heldVoices.set(midi, this.startVoice(midi, velocity, at));
  }

  noteOff(midi: number, when?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const voice = this.heldVoices.get(midi);
    if (!voice) return;
    this.heldVoices.delete(midi);
    this.releaseVoice(voice, when ?? ctx.currentTime);
  }

  /** Fire-and-forget note for the scheduler: starts at `when`, releases itself. */
  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = when ?? ctx.currentTime;
    const voice = this.startVoice(midi, velocity, at);
    this.releaseVoice(voice, at + durationSec);
  }

  allNotesOff(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const voice of [...this.active]) this.releaseVoice(voice, now);
    this.heldVoices.clear();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.active.clear();
    this.heldVoices.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export { synthSchema };
export type { Waveform };
