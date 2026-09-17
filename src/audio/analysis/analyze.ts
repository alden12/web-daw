/**
 * Objective mix analysis (AGENT-4.1, "agent ears") - the first, most tractable tier: cheap,
 * deterministic time-domain measures over a rendered buffer that the agent can act on directly.
 *
 * `analyzeMix` is pure Float32 math (no Web Audio), so it runs anywhere and is unit-testable
 * without a real AudioBuffer - it reads only the small `AudioBufferLike` surface. `summarizeMix`
 * turns the raw numbers into a compact, model-friendly report (rounded dB + a plain-language note).
 * Spectral balance / masking and integrated LUFS are the next tiers (AGENT-4.1 follow-ups / 4.2).
 */

/** The slice of AudioBuffer we read - so analysis is testable with a plain stub. */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface MixAnalysis {
  sampleRate: number;
  durationSec: number;
  channels: number;
  /** Peak absolute sample across all channels (linear; can exceed 1.0 if over full scale). */
  peak: number;
  /** Peak in dBFS (<= 0 below full scale; > 0 over). Floored at -120 for silence. */
  peakDbfs: number;
  /** RMS over the whole buffer, all channels (linear) - a rough loudness proxy. */
  rms: number;
  rmsDbfs: number;
  /** dB from the peak to full scale (>= 0 means headroom remains; < 0 means over). */
  headroomDb: number;
  clipping: { clipped: boolean; sampleCount: number; fraction: number };
}

/** Samples at/above this magnitude count as clipped (~-0.009 dBFS, i.e. effectively full scale). */
const CLIP_THRESHOLD = 0.999;
const DBFS_FLOOR = -120;

function toDbfs(linear: number): number {
  return linear > 1e-6 ? 20 * Math.log10(linear) : DBFS_FLOOR;
}

/** Measure peak, RMS loudness, and clipping over a rendered buffer in a single pass. */
export function analyzeMix(buffer: AudioBufferLike): MixAnalysis {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  let peak = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const sample = samples[index];
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
      sumSquares += sample * sample;
      if (magnitude >= CLIP_THRESHOLD) clippedSamples += 1;
    }
  }
  const total = channels * length || 1;
  const rms = Math.sqrt(sumSquares / total);
  const peakDbfs = toDbfs(peak);
  return {
    sampleRate: buffer.sampleRate,
    durationSec: buffer.duration,
    channels,
    peak,
    peakDbfs,
    rms,
    rmsDbfs: toDbfs(rms),
    headroomDb: -peakDbfs,
    clipping: { clipped: clippedSamples > 0, sampleCount: clippedSamples, fraction: clippedSamples / total },
  };
}

/** A compact, model-friendly report: rounded dB figures plus a plain-language verdict. */
export interface MixSummary {
  durationSec: number;
  peakDbfs: number;
  headroomDb: number;
  loudnessDbfs: number;
  clipping: boolean;
  clippedSamples: number;
  note: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function summarizeMix(analysis: MixAnalysis): MixSummary {
  const notes: string[] = [];
  if (analysis.peak === 0) {
    notes.push("Silent - the project produced no sound (no notes, or every track muted / undecoded).");
  } else {
    if (analysis.clipping.clipped) {
      notes.push(`Clipping: ${analysis.clipping.sampleCount} sample(s) at full scale - reduce track or master levels.`);
    } else if (analysis.peakDbfs > -1) {
      notes.push("Very hot - peaks are near full scale with little headroom.");
    }
    if (analysis.rmsDbfs < -30) notes.push("Quiet overall (low RMS) - there is room to bring the level up.");
  }
  return {
    durationSec: round1(analysis.durationSec),
    peakDbfs: round1(analysis.peakDbfs),
    headroomDb: round1(analysis.headroomDb),
    loudnessDbfs: round1(analysis.rmsDbfs),
    clipping: analysis.clipping.clipped,
    clippedSamples: analysis.clipping.sampleCount,
    note: notes.join(" ") || "Levels look healthy.",
  };
}
