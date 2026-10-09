/**
 * Sound portraits (COMM-1.9.2): the art on an Explore card, drawn from what the device actually
 * does rather than picked to look nice. Pure functions from samples or notes to SVG path data in a
 * 100 x 100 box, so they are testable without audio and the same in the browser and in Node.
 *
 * Four drawings, chosen by what is true of the sound (`renderPortraits.ts` decides which):
 * - **Phase scope** (`line`): a steady sound against itself a quarter-cycle later. One pure tone is
 *   an ellipse; harmonics knot it; clipping squares it off. The timbre, at a glance.
 * - **Transfer** (`line`): an effect's output against the sine fed in. Distortion bends it into an
 *   S, a bitcrusher steps it, a filter opens it into an ellipse, a tremolo fans it out.
 * - **Envelope** (`fill`): loudness over time, mirrored. A drum's hit and decay, a delay's echoes,
 *   a reverb's tail.
 * - **Phrase** (`fill`): note blocks over time, for a MIDI device's output.
 */

export interface Portrait {
  /** A stroked path (the phase scope). */
  line?: string;
  /** A filled path (envelope, phrase). */
  fill?: string;
}

const SIZE = 100;
const CENTRE = SIZE / 2;
const round = (value: number) => Math.round(value * 10) / 10;
const point = (x: number, y: number) => `${round(x)} ${round(y)}`;

const peakOf = (samples: Float32Array, from = 0, to = samples.length) =>
  samples.subarray(from, to).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);

/** Whether the sound is still going at `atSec`: louder there than a twentieth of its peak. */
export function isSustained(samples: Float32Array, sampleRate: number, atSec = 0.45): boolean {
  const from = Math.floor(atSec * sampleRate);
  const to = Math.min(samples.length, from + Math.floor(0.05 * sampleRate));
  const peak = peakOf(samples);
  return peak > 0 && to > from && peakOf(samples, from, to) > peak * 0.05;
}

/**
 * Two cycles of a steady sound at `frequency`, from `fromSec` on (past the attack), plotted against
 * itself a quarter-cycle later. Scaled to its own peak, so a quiet sound draws as large as a loud
 * one: the shape is the point, not the level.
 */
export function phaseScope(
  samples: Float32Array,
  sampleRate: number,
  frequency: number,
  { fromSec = 0.45, cycles = 2, points = 180 }: { fromSec?: number; cycles?: number; points?: number } = {},
): string {
  const period = sampleRate / frequency;
  const quarter = Math.round(period / 4);
  const start = Math.min(Math.floor(fromSec * sampleRate), Math.max(0, samples.length - quarter - 1));
  const span = Math.min(period * cycles, samples.length - start - quarter - 1);
  const pairs = Array.from({ length: points + 1 }, (_, index) => {
    const at = start + Math.round((index / points) * span);
    return [samples[at] ?? 0, samples[at + quarter] ?? 0] as const;
  });
  const scale = Math.max(...pairs.flat().map(Math.abs)) || 1;
  return pairs
    .map(([x, y], index) => `${index ? "L" : "M"}${point(CENTRE + (x / scale) * 40, CENTRE - (y / scale) * 40)}`)
    .join(" ");
}

/**
 * How long a sound lasts: seconds until its loudness (RMS over 10ms windows) last rises above a
 * fiftieth of its loudest window. Windowed, because a reverb's tail is quiet sample by sample but
 * dense: against a raw peak it would never register.
 */
export function ringSeconds(samples: Float32Array, sampleRate: number): number {
  const windowLength = Math.max(1, Math.round(0.01 * sampleRate));
  const levels = Array.from({ length: Math.floor(samples.length / windowLength) }, (_, index) => {
    const window = samples.subarray(index * windowLength, (index + 1) * windowLength);
    return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
  });
  const loudest = Math.max(0, ...levels);
  return loudest > 0 ? ((levels.findLastIndex((level) => level > loudest / 50) + 1) * windowLength) / sampleRate : 0;
}

/**
 * An effect's output (`samples`) against the sine that went in, over `seconds` from `fromSec`.
 * The input is the oscillator's own formula, so nothing has to be recorded alongside.
 */
export function transfer(
  samples: Float32Array,
  sampleRate: number,
  frequency: number,
  { fromSec = 0.3, seconds = 0.4, points = 360 }: { fromSec?: number; seconds?: number; points?: number } = {},
): string {
  const start = Math.floor(fromSec * sampleRate);
  const span = Math.min(Math.floor(seconds * sampleRate), samples.length - start - 1);
  const pairs = Array.from({ length: points + 1 }, (_, index) => {
    const at = start + Math.round((index / points) * span);
    return [Math.sin((2 * Math.PI * frequency * at) / sampleRate), samples[at] ?? 0] as const;
  });
  const scale = Math.max(...pairs.map(([, output]) => Math.abs(output))) || 1;
  return pairs
    .map(
      ([input, output], index) => `${index ? "L" : "M"}${point(CENTRE + input * 40, CENTRE - (output / scale) * 40)}`,
    )
    .join(" ");
}

/**
 * Loudness over time, mirrored about the middle, from the start to where the sound falls under a
 * hundredth of its peak. Square-rooted so a tail is visible rather than a hairline under its hit.
 */
export function envelope(samples: Float32Array, { buckets = 64 }: { buckets?: number } = {}): string {
  const peak = peakOf(samples) || 1;
  const lastLoud = samples.findLastIndex((sample) => Math.abs(sample) > peak * 0.01);
  const length = Math.max(buckets, Math.ceil((lastLoud + 1) * 1.05));
  const heights = Array.from({ length: buckets }, (_, index) => {
    const from = Math.floor((index / buckets) * length);
    const to = Math.max(from + 1, Math.floor(((index + 1) / buckets) * length));
    return Math.sqrt(peakOf(samples, from, Math.min(to, samples.length)) / peak) * 38 + 0.5;
  });
  const x = (index: number) => 8 + (index / (buckets - 1)) * 84;
  const top = heights.map((height, index) => point(x(index), CENTRE - height));
  const bottom = heights.map((height, index) => point(x(index), CENTRE + height)).reverse();
  return `M${[...top, ...bottom].join(" L")} Z`;
}

export interface PhraseNote {
  pitch: number;
  /** Seconds from the phrase's start. */
  start: number;
  length: number;
}

/**
 * Note blocks over `spanSec`, one row per **distinct pitch played** (low at the bottom) rather than
 * per semitone: at card size a triad spread over eight semitone rows is three hairlines, where
 * three rows of its own are three bars you can see. The contour survives; the intervals do not
 * need to. At least 4 rows, so a single repeated note is not one slab filling the card.
 */
export function phrase(notes: PhraseNote[], spanSec: number): string {
  if (notes.length === 0) return "";
  const pitches = [...new Set(notes.map((note) => note.pitch))].sort((low, high) => low - high);
  const rows = Math.max(4, pitches.length);
  const rowHeight = 76 / rows;
  const x = (seconds: number) => 8 + (Math.min(seconds, spanSec) / spanSec) * 84;
  return notes
    .filter((note) => note.start < spanSec)
    .map((note) => {
      const left = x(note.start);
      const width = Math.max(0.8, x(note.start + note.length) - left - 0.8);
      const top = 12 + (rows - 1 - pitches.indexOf(note.pitch)) * rowHeight;
      return `M${point(left, top)} h${round(width)} v${round(Math.max(0.8, rowHeight - 2))} h${round(-width)} Z`;
    })
    .join(" ");
}
