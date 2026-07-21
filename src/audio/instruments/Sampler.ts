/**
 * A single-voice sampler: each note plays one audio buffer through the shared
 * amp envelope. The selected sample is a `sample` param (a tagged ref); the
 * built-in kit is fetched + decoded lazily and cached (see builtinUrls). Notes
 * play the sample as a one-shot (the whole buffer sounds regardless of note
 * length, the percussive default), pitched by playback rate when keytracking.
 *
 * Added via the registration API like the synths - schema in catalog.ts, factory
 * in registry.ts. It is the first consumer of the `sample` param kind and of the
 * generalized voice (an AudioBufferSourceNode in place of oscillators).
 */
import type { ParamStore } from "../params/store";
import { BaseInstrument } from "./BaseInstrument";
import type { VoiceHandle } from "./types";
import type { ParamBinding } from "./binding";
import { loadSampleBuffer } from "../samples/builtinUrls";

/** Pitch ratio for a note: 2^(semitones/root) when keytracking, else unity. */
export function playbackRateFor(midi: number, root: number, keytrack: boolean): number {
  return keytrack ? Math.pow(2, (midi - root) / 12) : 1;
}

export class SamplerInstrument extends BaseInstrument {
  private buffer: AudioBuffer | null = null;
  /** The ref currently being/just loaded, so a stale async load can't clobber. */
  private currentRef = "";
  /** The latest sample load, so an offline render can await readiness (see Instrument.ready). */
  private loadPromise: Promise<void> = Promise.resolve();
  private root = 60;
  private keytrack = true;
  private disposed = false;
  // A 1-frame silent buffer so a voice still has a finite source (and fires
  // onended -> cleanup) before the real sample finishes decoding.
  private readonly silence: AudioBuffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);

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
      "sampler.sample": { apply: (v) => this.loadSample(v as string) },
      "sampler.root": { apply: (v) => void (this.root = v as number) },
      "sampler.keytrack": { apply: (v) => void (this.keytrack = v as boolean) },
    };
  }

  private loadSample(ref: string): void {
    this.currentRef = ref;
    this.loadPromise = loadSampleBuffer(this.ctx, ref)
      .then((buffer) => {
        if (!this.disposed && this.currentRef === ref) this.buffer = buffer;
      })
      .catch(() => {
        if (!this.disposed && this.currentRef === ref) this.buffer = null;
      });
  }

  ready(): Promise<void> {
    return this.loadPromise;
  }

  protected createVoice(midi: number, when: number): VoiceHandle {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer ?? this.silence;
    source.playbackRate.setValueAtTime(playbackRateFor(midi, this.root, this.keytrack), when);
    const amp = this.ctx.createGain();
    source.connect(amp).connect(this.output);
    return { amp, sources: [source] };
  }

  // One-shot: ignore the requested note length and let the whole sample play
  // (rate-adjusted). Falls back to the given length until the buffer is decoded.
  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const rate = playbackRateFor(midi, this.root, this.keytrack);
    const oneShot = this.buffer ? this.buffer.duration / rate : durationSec;
    super.playNote(midi, oneShot, velocity, when);
  }

  dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}
