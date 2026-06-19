/**
 * The synth engine (main thread). Owns the AudioContext and the native audio
 * graph, and is the one place the parameter store is wired to audio: it
 * subscribes to the store once and routes every change through the bindings.
 *
 * Graph: per-note [OscillatorNode -> GainNode(ADSR)] -> BiquadFilter -> masterGain -> destination
 * Voicing: mono (one active voice, retriggered).
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
  private voice: Voice | null = null;
  private unsubscribe: (() => void) | null = null;

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
      () => this.voice,
    );

    // Push current store values into the graph, then keep them in sync.
    for (const spec of synthSchema) {
      this.applyParam(spec.id);
    }
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

  noteOn(midi: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // Mono: stop any currently sounding voice immediately before retriggering.
    this.stopVoice(0);

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = this.voiceState.waveform as OscillatorType;
    osc.detune.setValueAtTime(this.voiceState.detune, now);
    osc.frequency.setValueAtTime(midiToFreq(midi), now);

    const gain = ctx.createGain();
    osc.connect(gain).connect(this.filter);

    // Attack ramp from 0 to 1 on the per-voice gain.
    const attack = this.voiceState.attackMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + attack);

    osc.start(now);
    this.voice = { osc, gain };
  }

  noteOff(): void {
    const ctx = this.ctx;
    if (!ctx || !this.voice) return;
    this.stopVoice(this.voiceState.releaseMs / 1000);
  }

  /** Release the active voice over `releaseSec`, then tear it down. */
  private stopVoice(releaseSec: number): void {
    const ctx = this.ctx;
    const voice = this.voice;
    if (!ctx || !voice) return;
    this.voice = null;

    const now = ctx.currentTime;
    const { osc, gain } = voice;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + releaseSec);

    osc.stop(now + releaseSec + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopVoice(0);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export { synthSchema };
export type { Waveform };
