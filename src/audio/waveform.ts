/**
 * Waveform peak overview for audio clips: decode a stored sample once, reduce it to
 * a fixed-size min/max peak array, and cache it by `fileId`. The UI draws the peaks
 * (scaled to whatever width) on the arrangement clip and the audio-clip panel.
 *
 * Decoding uses an OfflineAudioContext, so peaks compute without the engine started
 * and off the realtime path. `computePeaks` is pure (no Web Audio), so the bucketing
 * is unit-testable; everything below it is browser-only and never imported by the
 * DOM-free Node server.
 */
import { getAudioBuffer } from "./audioStore";

/** A min/max pair per bucket, both in [-1, 1]; `min.length === max.length`. */
export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

/** Fixed bucket count: resolution independent of file length (caps big-file cost). */
export const PEAK_BUCKETS = 2048;

/**
 * Pure: reduce mono samples to `buckets` min/max pairs. Each bucket spans an equal
 * slice of the samples; a bucket with no samples is flat (0). Clamps `buckets` to the
 * sample count so short clips don't produce empty buckets.
 */
export function computePeaks(samples: Float32Array, buckets: number): Peaks {
  const n = Math.max(1, Math.min(buckets, samples.length || 1));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  if (!samples.length) return { min, max };
  const per = samples.length / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(samples.length, Math.floor((b + 1) * per));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo === Infinity) {
      lo = 0;
      hi = 0;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/** Average all channels to mono (so the overview reflects the whole signal). */
function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels <= 1) return buffer.getChannelData(0);
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  for (let i = 0; i < len; i++) out[i] /= buffer.numberOfChannels;
  return out;
}

const cache = new Map<string, Peaks>();
const pending = new Map<string, Promise<Peaks | null>>();

/** Cached peaks for a file, or undefined if not computed yet (sync, for first paint). */
export function cachedPeaks(fileId: string): Peaks | undefined {
  return cache.get(fileId);
}

/**
 * Load (decode + reduce) the peaks for a file, caching and de-duping in-flight work.
 * Resolves null on any failure so callers fall back to a plain block.
 */
export function loadPeaks(fileId: string): Promise<Peaks | null> {
  if (!fileId) return Promise.resolve(null);
  const hit = cache.get(fileId);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(fileId);
  if (inflight) return inflight;

  const job = (async () => {
    try {
      const bytes = await getAudioBuffer(fileId);
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(bytes);
      const peaks = computePeaks(mixToMono(buffer), PEAK_BUCKETS);
      cache.set(fileId, peaks);
      return peaks;
    } catch {
      return null;
    } finally {
      pending.delete(fileId);
    }
  })();
  pending.set(fileId, job);
  return job;
}
