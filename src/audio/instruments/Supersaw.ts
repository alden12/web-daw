/**
 * Supersaw: a stack of detuned sawtooth oscillators summed into one voice for a
 * thick, wide unison lead/pad. `super.voices` sets how many saws, `super.detune`
 * spreads them in cents around the note. Count/spread apply to subsequent notes
 * (each note builds a fresh voice), heard within a beat during playback.
 *
 * Added through the registration API (schema in catalog.ts, factory in
 * registry.ts) - a second worked example, this time on the instrument path.
 */
import type { ParamStore } from "../params/store";
import { BaseInstrument } from "./BaseInstrument";
import type { VoiceHandle } from "./types";
import { midiToFreq, type ParamBinding } from "./binding";

export class SupersawInstrument extends BaseInstrument {
  private count = 7;
  private spread = 25;

  constructor(ctx: BaseAudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    // Voices connect straight to output; no shared nodes.
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      "super.voices": { apply: (v) => void (this.count = v as number) },
      "super.detune": { apply: (v) => void (this.spread = v as number) },
    };
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const freq = midiToFreq(midi);
    const n = Math.max(1, Math.round(this.count));
    const amp = this.ctx.createGain();
    // Sum the saws through a 1/n mix so loudness stays roughly constant with the
    // voice count. The mix node is disconnected with the voice (GC'd) when the
    // base stops the oscillators and disconnects amp.
    const mix = this.ctx.createGain();
    mix.gain.value = 1 / n;
    mix.connect(amp).connect(this.output);
    const oscillators: OscillatorNode[] = [];
    for (let i = 0; i < n; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, when);
      const detune = n === 1 ? 0 : -this.spread + (2 * this.spread * i) / (n - 1);
      osc.detune.setValueAtTime(detune, when);
      osc.connect(mix);
      oscillators.push(osc);
    }
    return { amp, sources: oscillators };
  }
}
