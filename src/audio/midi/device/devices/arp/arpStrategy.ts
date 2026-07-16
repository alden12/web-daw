/**
 * The `arpeggiate` strategy: a stateful, clock-driven note generator. It treats every held
 * note as a time span (live noteOn -> open-ended until noteOff; playback playNote -> a closed
 * [when, when+dur] span) and walks a tempo grid over the union of held spans, emitting the
 * pattern's next pitch at each step as a short `playNote` downstream. One implementation
 * serves both live and playback because both reduce to "which spans cover this step time".
 *
 * A self-driven lookahead (the scheduler's "two clocks" pattern) schedules steps ~ahead of the
 * audio clock; `scheduleWindow` is the pure-ish core (given the held spans + clock, forward the
 * steps in a time window) so it can be unit-tested without the timer. When the transport is
 * playing, steps lock to its beat grid; when stopped, they free-run from the chord's first onset.
 */
import type { MidiStrategy, StrategyContext } from "../../strategy";
import type { MidiTransform } from "../../transform";
import { arpPitch, rateToBeats, type ArpPattern } from "./pattern";
import { clamp } from "../../../../../util";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

interface HeldSpan {
  start: number;
  end: number;
  velocity: number;
}

export class ArpStrategy implements MidiStrategy {
  private readonly transform: Extract<MidiTransform, { kind: "arpeggiate" }>;
  private readonly ctx: StrategyContext;

  private readonly held = new Map<number, HeldSpan>();
  private stepCount = 0;
  private anchorTime = 0;
  private scheduledUntil = 0;
  private pendingReset = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(transform: Extract<MidiTransform, { kind: "arpeggiate" }>, ctx: StrategyContext) {
    this.transform = transform;
    this.ctx = ctx;
  }

  private now(): number {
    return this.ctx.clock.currentTime;
  }

  /** Reset the pattern (and the free-run anchor) when a chord begins after silence. */
  private beginIfFresh(startTime: number): void {
    const active = [...this.held.values()].some((span) => span.end > this.now());
    if (!active) {
      this.stepCount = 0;
      this.anchorTime = startTime;
      this.pendingReset = false;
    }
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    const start = when ?? this.now();
    this.beginIfFresh(start);
    this.held.set(midi, { start, end: Infinity, velocity });
    this.ensureRunning();
  }

  noteOff(midi: number): void {
    this.held.delete(midi);
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const start = when ?? this.now();
    this.beginIfFresh(start);
    this.held.set(midi, { start, end: start + durationSec, velocity });
    this.ensureRunning();
  }

  allNotesOff(): void {
    this.held.clear();
    this.pendingReset = true;
    this.stop();
  }

  dispose(): void {
    this.held.clear();
    this.stop();
  }

  private ensureRunning(): void {
    if (this.timer) return;
    this.scheduledUntil = this.now();
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = this.now();
    for (const [midi, span] of this.held) if (span.end <= now) this.held.delete(midi);
    if (this.held.size === 0) {
      this.pendingReset = true;
      this.stop();
      return;
    }
    const to = now + SCHEDULE_AHEAD_SEC;
    this.scheduleWindow(this.scheduledUntil, to);
    this.scheduledUntil = Math.max(this.scheduledUntil, to);
  }

  /**
   * Forward every arp step whose grid time lands in [fromTime, toTime) to the downstream target.
   * Pure w.r.t. the timer (the tick calls it; tests call it directly with a fake clock + next).
   */
  scheduleWindow(fromTime: number, toTime: number): void {
    const { clock, store, next } = this.ctx;
    const secondsPerBeat = clock.secondsPerBeat;
    const stepBeats = rateToBeats(store.get(this.transform.rate) as string);
    const stepSec = Math.max(0.02, stepBeats * secondsPerBeat);
    const gate = clamp((store.get(this.transform.gate) as number) ?? 0.5, 0.05, 1);
    const pattern = store.get(this.transform.pattern) as ArpPattern;
    const octaves = (store.get(this.transform.octaves) as number) ?? 1;
    const target = next();

    for (const stepTime of this.stepTimes(fromTime, toTime, stepBeats, stepSec, secondsPerBeat)) {
      const pitches = [...this.held.entries()]
        .filter(([, span]) => span.start <= stepTime && stepTime < span.end)
        .map(([midi]) => midi)
        .sort((a, b) => a - b);
      if (pitches.length === 0) {
        this.pendingReset = true;
        continue;
      }
      if (this.pendingReset) {
        this.stepCount = 0;
        this.pendingReset = false;
      }
      const pitch = arpPitch(pitches, pattern, octaves, this.stepCount);
      if (pitch !== null) {
        const velocity = Math.max(...pitches.map((midi) => this.held.get(midi)!.velocity));
        target.playNote(pitch, gate * stepSec, velocity, stepTime);
        this.stepCount++;
      }
    }
  }

  /** Grid step times in [fromTime, toTime): locked to the transport beat grid while playing,
   *  free-running from the chord's first onset (anchorTime) when stopped. */
  private stepTimes(
    fromTime: number,
    toTime: number,
    stepBeats: number,
    stepSec: number,
    secondsPerBeat: number,
  ): number[] {
    // Half-open [fromTime, toTime): the step at the window start fires (so the first downbeat
    // isn't dropped), and successive lookahead windows share a boundary without double-emitting.
    const out: number[] = [];
    const epsilon = 1e-9;
    if (this.ctx.clock.playing) {
      const now = this.now();
      const beatAtNow = this.ctx.clock.continuousBeatAtTime(now);
      const timeAtBeat = (beat: number) => now + (beat - beatAtNow) * secondsPerBeat;
      const beatAtTime = (time: number) => beatAtNow + (time - now) / secondsPerBeat;
      let beat = Math.ceil(beatAtTime(fromTime) / stepBeats - epsilon) * stepBeats;
      for (let time = timeAtBeat(beat); time < toTime - epsilon; beat += stepBeats, time = timeAtBeat(beat)) {
        if (time >= fromTime - epsilon) out.push(time);
      }
    } else {
      let k = Math.ceil((fromTime - this.anchorTime) / stepSec - epsilon);
      for (
        let time = this.anchorTime + k * stepSec;
        time < toTime - epsilon;
        k++, time = this.anchorTime + k * stepSec
      ) {
        if (time >= fromTime - epsilon) out.push(time);
      }
    }
    return out;
  }
}
