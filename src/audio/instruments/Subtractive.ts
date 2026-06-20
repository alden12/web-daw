/**
 * Subtractive instrument: per-voice oscillator -> amp, summed through one shared
 * lowpass filter (paraphonic) -> output. This is slice 1's synth, now expressed
 * as a BaseInstrument subclass.
 */
import type { ParamStore } from '../params/store';
import { BaseInstrument } from './BaseInstrument';
import type { VoiceHandle } from './types';
import { midiToFreq, rampParam, type ParamBinding } from './binding';
import { type Waveform } from './catalog';

export class SubtractiveInstrument extends BaseInstrument {
  private filter!: BiquadFilterNode;
  private waveform: Waveform = 'sawtooth';
  private detune = 0;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.connect(this.output);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      'filter.cutoff': { apply: (v, ms) => rampParam(this.ctx, this.filter.frequency, v as number, ms) },
      'filter.resonance': { apply: (v, ms) => rampParam(this.ctx, this.filter.Q, v as number, ms) },
      'osc.waveform': {
        apply: (v) => {
          this.waveform = v as Waveform;
          for (const voice of this.voices) voice.oscillators[0].type = v as Waveform;
        },
      },
      'osc.detune': {
        apply: (v, ms) => {
          this.detune = v as number;
          for (const voice of this.voices) rampParam(this.ctx, voice.oscillators[0].detune, v as number, ms);
        },
      },
    };
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const osc = this.ctx.createOscillator();
    osc.type = this.waveform;
    osc.detune.setValueAtTime(this.detune, when);
    osc.frequency.setValueAtTime(midiToFreq(midi), when);
    const amp = this.ctx.createGain();
    osc.connect(amp).connect(this.filter);
    return { amp, oscillators: [osc] };
  }
}
