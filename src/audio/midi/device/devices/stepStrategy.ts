/**
 * The shared machinery behind the clock-driven *generator* devices (the arpeggiator and the
 * Euclidean sequencer). Both treat every held note as a time span (live noteOn -> open-ended
 * until noteOff; playback playNote -> a closed [when, when+dur] span), walk a tempo grid over
 * the union of held spans, and emit something at each step. One implementation serves both live
 * and playback because both reduce to "which spans cover this step time".
 *
 * A self-driven lookahead (the scheduler's "two clocks" pattern) schedules steps ~ahead of the
 * audio clock; `scheduleWindow` is the pure-ish core (given the held spans + clock, forward the
 * steps in a time window) so it can be unit-tested without the timer. When the transport is
 * playing, steps lock to its beat grid; when stopped, they free-run from the phrase's first onset.
 *
 * Subclasses supply only the two things that differ: how long a step is (`stepBeats`, read from
 * their own params) and what to play at one (`emitStep`).
 */
import type { MidiStrategy, StrategyContext } from "../strategy";
import type { NoteTarget } from "../GraphMidiDevice";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

interface HeldSpan {
  start: number;
  end: number;
  velocity: number;
}

/** One step's worth of context handed to the subclass. */
export interface StepContext {
  /** The live downstream target (resolved once per window). */
  target: NoteTarget;
  /** Audio-clock time this step lands on. */
  stepTime: number;
  /** Length of one step in seconds. */
  stepSec: number;
  /** Held pitches covering this step, ascending. Never empty. */
  pitches: number[];
  /** The loudest held velocity covering this step. */
  velocity: number;
  /** Monotonic step index since the phrase began (resets when the held set empties). */
  stepIndex: number;
}

export abstract class StepStrategy implements MidiStrategy {
  protected readonly ctx: StrategyContext;

  private readonly held = new Map<number, HeldSpan>();
  private stepCount = 0;
  private anchorTime = 0;
  private scheduledUntil = 0;
  private pendingReset = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: StrategyContext) {
    this.ctx = ctx;
  }

  /** Beats per step, read from the device's own params. */
  protected abstract stepBeats(): number;

  /** Emit whatever this device plays at one step (the subclass's whole personality). */
  protected abstract emitStep(step: StepContext): void;

  private now(): number {
    return this.ctx.clock.currentTime;
  }

  /** Reset the pattern (and the free-run anchor) when a phrase begins after silence. */
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
   * Forward every step whose grid time lands in [fromTime, toTime) to the downstream target.
   * Pure w.r.t. the timer (the tick calls it; tests call it directly with a fake clock + next).
   */
  scheduleWindow(fromTime: number, toTime: number): void {
    const secondsPerBeat = this.ctx.clock.secondsPerBeat;
    const stepBeats = this.stepBeats();
    const stepSec = Math.max(0.02, stepBeats * secondsPerBeat);
    const target = this.ctx.next();

    for (const stepTime of this.stepTimes(fromTime, toTime, stepBeats, stepSec, secondsPerBeat)) {
      const covering = [...this.held.entries()]
        .filter(([, span]) => span.start <= stepTime && stepTime < span.end)
        .sort(([a], [b]) => a - b);
      if (covering.length === 0) {
        this.pendingReset = true;
        continue;
      }
      if (this.pendingReset) {
        this.stepCount = 0;
        this.pendingReset = false;
      }
      this.emitStep({
        target,
        stepTime,
        stepSec,
        pitches: covering.map(([midi]) => midi),
        velocity: Math.max(...covering.map(([, span]) => span.velocity)),
        stepIndex: this.stepCount,
      });
      this.stepCount++;
    }
  }

  /** Grid step times in [fromTime, toTime): locked to the transport beat grid while playing,
   *  free-running from the phrase's first onset (anchorTime) when stopped. */
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
