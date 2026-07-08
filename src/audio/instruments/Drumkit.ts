/**
 * A multi-pad drum kit: a bank of one-shot sample players. Unlike the Sampler, a
 * played MIDI note *selects a pad* rather than pitching one sample - which note fires
 * a pad is a per-pad param (`pad{n}.note`), defaulting to a contiguous low octave, so
 * the piano roll / step grid map notes onto the kit. Each pad has its own sample (a
 * `sample` ref, decoded lazily via the shared cache), note, level, and tune; the note
 * plays it as a one-shot at the pad's tune (no keytracking). All of that is driven by
 * the schema (pad{n}.sample/note/level/tune), so this needs no per-pad code beyond
 * binding, and remapping a pad's note is just a param change.
 *
 * Registered like any instrument: schema in catalog.ts, factory in registry.ts.
 */
import type { ParamStore } from "../params/store";
import { BaseInstrument } from "./BaseInstrument";
import type { VoiceHandle } from "./types";
import type { ParamBinding } from "./binding";
import { loadSampleBuffer } from "../samples/builtinUrls";
import { DRUMKIT_PADS, noteForPad } from "./catalog";

interface Pad {
  ref: string;
  buffer: AudioBuffer | null;
  note: number; // the MIDI note that fires this pad
  level: number;
  tune: number; // semitones
}

export class DrumkitInstrument extends BaseInstrument {
  private readonly pads: Pad[] = Array.from({ length: DRUMKIT_PADS }, (_unused, index) => ({
    ref: "",
    buffer: null,
    note: noteForPad(index),
    level: 0.85,
    tune: 0,
  }));
  private disposed = false;
  // A 1-frame silent buffer so a voice for an empty/undecoded pad still has a finite
  // source (fires onended -> cleanup) rather than nothing.
  private readonly silence: AudioBuffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    // Voices connect straight to output; no shared nodes.
  }

  protected buildBindings(): Record<string, ParamBinding> {
    const bindings: Record<string, ParamBinding> = { ...this.commonBindings() };
    this.pads.forEach((pad, index) => {
      const n = index + 1;
      bindings[`pad${n}.sample`] = { apply: (v) => this.loadPad(index, v as string) };
      bindings[`pad${n}.note`] = { apply: (v) => void (pad.note = v as number) };
      bindings[`pad${n}.level`] = { apply: (v) => void (pad.level = v as number) };
      bindings[`pad${n}.tune`] = { apply: (v) => void (pad.tune = v as number) };
    });
    return bindings;
  }

  private loadPad(index: number, ref: string): void {
    const pad = this.pads[index];
    pad.ref = ref;
    if (!ref) {
      pad.buffer = null;
      return;
    }
    loadSampleBuffer(this.ctx, ref)
      .then((buffer) => {
        if (!this.disposed && pad.ref === ref) pad.buffer = buffer;
      })
      .catch(() => {
        if (!this.disposed && pad.ref === ref) pad.buffer = null;
      });
  }

  // The note -> pad mapping is data: find the pad assigned this note. (If two pads share
  // a note, the first wins; the default layout assigns each pad a distinct note.)
  private padFor(midi: number): Pad | undefined {
    return this.pads.find((pad) => pad.note === midi);
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const pad = this.padFor(midi);
    const source = this.ctx.createBufferSource();
    source.buffer = pad?.buffer ?? this.silence;
    source.playbackRate.setValueAtTime(Math.pow(2, (pad?.tune ?? 0) / 12), when);
    // Per-pad level sits before the base's enveloped amp gain, so it scales the pad
    // without the attack/release ramp clobbering it.
    const level = this.ctx.createGain();
    level.gain.value = pad?.level ?? 1;
    const amp = this.ctx.createGain();
    source.connect(level).connect(amp).connect(this.output);
    return { amp, sources: [source] };
  }

  // One-shot: play the whole pad sample regardless of the sequenced note length.
  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const pad = this.padFor(midi);
    const rate = Math.pow(2, (pad?.tune ?? 0) / 12);
    const oneShot = pad?.buffer ? pad.buffer.duration / rate : durationSec;
    super.playNote(midi, oneShot, velocity, when);
  }

  dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}
