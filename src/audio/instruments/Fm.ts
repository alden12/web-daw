/**
 * 2-operator FM instrument: a modulator oscillator drives the carrier's
 * frequency (modulator -> modGain -> carrier.frequency), carrier -> amp ->
 * output. `fm.ratio` sets modulator:carrier frequency ratio; `fm.index` sets
 * modulation depth in Hz. Ratio/index apply to subsequent notes (each note
 * builds a fresh voice), which during playback is heard within a beat.
 */
import type { ParamStore } from "../params/store";
import { BaseInstrument } from "./BaseInstrument";
import type { VoiceHandle } from "./types";
import { midiToFreq, type ParamBinding } from "./binding";

export class FmInstrument extends BaseInstrument {
  private ratio = 2;
  private index = 300;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    // Voices connect straight to output; no shared nodes.
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      "fm.ratio": { apply: (v) => void (this.ratio = v as number) },
      "fm.index": { apply: (v) => void (this.index = v as number) },
    };
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const freq = midiToFreq(midi);
    const carrier = this.ctx.createOscillator();
    carrier.frequency.setValueAtTime(freq, when);

    const modulator = this.ctx.createOscillator();
    modulator.frequency.setValueAtTime(freq * this.ratio, when);

    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(this.index, when);
    modulator.connect(modGain).connect(carrier.frequency);

    const amp = this.ctx.createGain();
    carrier.connect(amp).connect(this.output);
    return { amp, sources: [carrier, modulator] };
  }
}
