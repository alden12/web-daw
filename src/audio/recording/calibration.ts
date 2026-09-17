/**
 * Mic latency calibration by ear-and-tap. The engine plays a steady train of metronome
 * clicks and records the mic; the performer taps the mic (or claps) on each click. The
 * gap between when a click was scheduled to sound and when its tap was captured is the
 * round-trip latency (output + input + a little human error, absorbed by the median).
 * That median becomes the recording offset - an acoustic loopback, no cable needed.
 *
 * The DSP (`detectOnsets`, `estimateOffsetMs`) is pure and unit-tested; `runMicCalibration`
 * is the thin orchestration over the engine's existing click + capture pipeline. A
 * deliberately slow click interval keeps every tap unambiguously nearest its own click.
 */

/** Minimal engine surface the calibration needs (AudioEngine satisfies it). */
export interface CalibrationEngine {
  readonly currentTime: number;
  enableInput(deviceId?: string): Promise<void>;
  disableInput(): void;
  scheduleClick(when: number, accent: boolean): void;
  startRecording(): number;
  stopRecording(): Promise<{ samples: Float32Array; sampleRate: number } | null>;
}

export interface OnsetOptions {
  /** Trigger level as a fraction of the loudest envelope value (0..1). */
  thresholdRatio?: number;
  /** Minimum gap between successive onsets, seconds (debounces one tap's ringing). */
  refractorySec?: number;
  /** Envelope smoothing window, seconds. */
  smoothingSec?: number;
}

/**
 * Onset times (seconds from the first sample) of the transients in a mono buffer,
 * via a smoothed-amplitude envelope crossing a fraction of its peak, with a refractory
 * gap so a single tap counts once.
 */
export function detectOnsets(samples: Float32Array, sampleRate: number, options: OnsetOptions = {}): number[] {
  const thresholdRatio = options.thresholdRatio ?? 0.3;
  const refractory = Math.max(1, Math.round((options.refractorySec ?? 0.08) * sampleRate));
  const window = Math.max(1, Math.round((options.smoothingSec ?? 0.004) * sampleRate));

  // Moving-average envelope of the rectified signal.
  const envelope = new Float32Array(samples.length);
  let sum = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    sum += Math.abs(samples[index]);
    if (index >= window) sum -= Math.abs(samples[index - window]);
    const value = sum / Math.min(index + 1, window);
    envelope[index] = value;
    if (value > peak) peak = value;
  }
  if (peak <= 0) return [];

  const threshold = peak * thresholdRatio;
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let index = 1; index < envelope.length; index++) {
    const rising = envelope[index] >= threshold && envelope[index - 1] < threshold;
    if (rising && index - lastOnset > refractory) {
      onsets.push(index / sampleRate);
      lastOnset = index;
    }
  }
  return onsets;
}

/**
 * Median gap (ms) between each click and the tap that answered it. Each onset is matched
 * to its nearest click and kept only if the gap is a plausible latency (roughly on-beat
 * to a fraction of a click late); the median rejects the odd missed or double tap.
 */
export function estimateOffsetMs(
  onsetTimes: number[],
  clickTimes: number[],
  toleranceSec: number,
): { offsetMs: number; matched: number; spreadMs: number } | null {
  if (!clickTimes.length) return null;
  const residuals: number[] = [];
  for (const onset of onsetTimes) {
    let nearest = clickTimes[0];
    let bestDistance = Infinity;
    for (const click of clickTimes) {
      const distance = Math.abs(onset - click);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = click;
      }
    }
    const gap = onset - nearest;
    // Taps land on or after the click (latency is positive); allow a little early drift.
    if (gap >= -0.12 && gap <= toleranceSec) residuals.push(gap);
  }
  if (!residuals.length) return null;
  const median = medianOf(residuals);
  // Median absolute deviation: how consistent the taps were (low = a confident reading). Reported
  // so the UI can flag a shaky calibration rather than silently trusting a wide spread of taps.
  const spread = medianOf(residuals.map((gap) => Math.abs(gap - median)));
  return { offsetMs: Math.round(median * 1000), matched: residuals.length, spreadMs: Math.round(spread * 1000) };
}

/** Median of a list (does not need to be pre-sorted). */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface CalibrationOptions {
  deviceId?: string;
  /** Number of clicks that count toward the estimate (taps to make after the count-in). */
  beats?: number;
  /**
   * Leading clicks to tap along with but exclude from the estimate. They let the performer
   * lock onto the tempo before the measured taps begin - the first taps are the jittery ones,
   * so dropping them tightens the median and the run-to-run spread.
   */
  countInBeats?: number;
  /** Seconds between clicks - slow enough that every tap is nearest its own click. */
  intervalSec?: number;
  /** Silent lead-in before the first click. */
  leadSec?: number;
  /** Fired at each click's scheduled sound time, for UI progress (best-effort). */
  onBeat?: (index: number, total: number, stage: "count-in" | "measure") => void;
}

export interface CalibrationResult {
  offsetMs: number;
  /** How many taps were matched to a click (confidence). */
  matched: number;
  beats: number;
  /** Consistency of the matched taps (median absolute deviation, ms); low = a tight reading. */
  spreadMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Play the click train, capture the taps, and return the measured offset (or null). */
export async function runMicCalibration(
  engine: CalibrationEngine,
  options: CalibrationOptions = {},
): Promise<CalibrationResult | null> {
  const beats = options.beats ?? 12;
  const countIn = options.countInBeats ?? 4;
  const interval = options.intervalSec ?? 0.75;
  const lead = options.leadSec ?? 0.6;
  const tail = 0.5;
  const totalClicks = countIn + beats;

  await engine.enableInput(options.deviceId);
  const captureStart = engine.startRecording();
  const firstClick = engine.currentTime + lead;
  for (let index = 0; index < totalClicks; index++) {
    engine.scheduleClick(firstClick + index * interval, index % 4 === 0);
    if (options.onBeat) {
      const delayMs = (firstClick + index * interval - engine.currentTime) * 1000;
      const stage = index < countIn ? "count-in" : "measure";
      const local = index < countIn ? index : index - countIn;
      const total = index < countIn ? countIn : beats;
      setTimeout(() => options.onBeat?.(local, total, stage), Math.max(0, delayMs));
    }
  }

  const endTime = firstClick + (totalClicks - 1) * interval + tail;
  await sleep((endTime - engine.currentTime) * 1000);
  const capture = await engine.stopRecording();
  engine.disableInput();
  if (!capture || capture.samples.length === 0) return null;

  // Estimate against the measured clicks only; ignore onsets from the count-in window so warm-up
  // taps never enter the median.
  const onsets = detectOnsets(capture.samples, capture.sampleRate);
  const measuredFirst = firstClick - captureStart + countIn * interval;
  const clickTimes = Array.from({ length: beats }, (_, index) => measuredFirst + index * interval);
  const measuredOnsets = onsets.filter((onset) => onset >= measuredFirst - interval / 2);
  const estimate = estimateOffsetMs(measuredOnsets, clickTimes, interval / 2);
  return estimate
    ? { offsetMs: estimate.offsetMs, matched: estimate.matched, beats, spreadMs: estimate.spreadMs }
    : null;
}
