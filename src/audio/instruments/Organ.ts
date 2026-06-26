/**
 * Additive organ: each note is a sum of harmonic sine partials (a drawbar-style
 * tone), summed into the voice amp. `organ.brightness` rolls the upper partials
 * in or out (brightness^(harmonic-1)), from a mellow fundamental to a bright,
 * reedy tone. Brightness applies to subsequent notes (each builds a fresh voice).
 *
 * A third synthesis style alongside subtractive and FM, added via the
 * registration API - schema in catalog.ts, factory in registry.ts.
 */
import type { ParamStore } from "../params/store";
import { BaseInstrument } from "./BaseInstrument";
import type { VoiceHandle } from "./types";
import { midiToFreq, type ParamBinding } from "./binding";

const HARMONICS = [1, 2, 3, 4, 5, 6];

export class OrganInstrument extends BaseInstrument {
  private brightness = 0.5;

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
      "organ.brightness": { apply: (v) => void (this.brightness = v as number) },
    };
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const freq = midiToFreq(midi);
    const weights = HARMONICS.map((h) => Math.pow(this.brightness, h - 1));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const amp = this.ctx.createGain();
    amp.connect(this.output);
    // Each partial: sine at freq*h through a fixed normalized gain into amp. The
    // partial gains ride out with the voice (GC'd when the base disconnects it).
    const oscillators = HARMONICS.map((h, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * h, when);
      const g = this.ctx.createGain();
      g.gain.value = weights[i] / sum;
      osc.connect(g).connect(amp);
      return osc;
    });
    return { amp, oscillators };
  }
}
