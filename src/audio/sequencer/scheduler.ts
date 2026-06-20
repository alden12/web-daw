/**
 * The playback scheduler: the brief's "Tale of Two Clocks". A coarse setInterval
 * wakes every LOOKAHEAD_MS and schedules note onsets that fall within the next
 * SCHEDULE_AHEAD_SEC, using the precise AudioContext clock via synth.playNote.
 * Playback loops at the clip's lengthBeats.
 *
 * Beat bookkeeping is anchored as (anchorBeat at anchorTime), so a tempo change
 * mid-playback re-anchors and stays continuous instead of jumping.
 */
import type { Synth } from '../synth/Synth';
import type { ClipStore } from './clipStore';
import type { NoteEvent } from './types';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

/** Pure: seconds for a number of beats at a tempo. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Pure: note occurrences whose onset lands in [fromBeat, toBeat), accounting for
 * the clip looping every loopLen beats. Returns the continuous beat of each.
 */
export function notesStartingInBeatRange(
  notes: NoteEvent[],
  fromBeat: number,
  toBeat: number,
  loopLen: number,
): { note: NoteEvent; atBeat: number }[] {
  const result: { note: NoteEvent; atBeat: number }[] = [];
  if (loopLen <= 0 || toBeat <= fromBeat) return result;
  const startIter = Math.floor(fromBeat / loopLen);
  const endIter = Math.ceil(toBeat / loopLen);
  for (let iter = startIter; iter <= endIter; iter++) {
    const base = iter * loopLen;
    for (const note of notes) {
      const at = base + note.start;
      if (at >= fromBeat && at < toBeat) result.push({ note, atBeat: at });
    }
  }
  return result;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  private anchorBeat = 0;
  private anchorTime = 0;
  private lastBps = 2; // 120 bpm
  private scheduledUntilBeats = 0;

  private readonly synth: Synth;
  private readonly clipStore: ClipStore;
  private readonly onStateChange?: (playing: boolean) => void;

  constructor(synth: Synth, clipStore: ClipStore, onStateChange?: (playing: boolean) => void) {
    this.synth = synth;
    this.clipStore = clipStore;
    this.onStateChange = onStateChange;
  }

  get isPlaying(): boolean {
    return this.timer !== null;
  }

  play(): void {
    if (this.timer !== null || !this.synth.started) return;
    this.anchorTime = this.synth.currentTime;
    this.anchorBeat = 0;
    this.scheduledUntilBeats = 0;
    this.lastBps = this.clipStore.getClip().tempoBpm / 60;
    // Re-anchor on tempo change so playback stays continuous.
    this.unsubscribe = this.clipStore.subscribe(() => this.reanchor());
    this.tick();
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
    this.onStateChange?.(true);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.synth.allNotesOff();
    this.onStateChange?.(false);
  }

  /** Looped position in beats for the playhead; 0 when stopped. */
  getPositionBeats(): number {
    if (this.timer === null) return 0;
    const clip = this.clipStore.getClip();
    const pos = this.anchorBeat + (this.synth.currentTime - this.anchorTime) * this.lastBps;
    return clip.lengthBeats > 0 ? pos % clip.lengthBeats : 0;
  }

  private reanchor(): void {
    const now = this.synth.currentTime;
    this.anchorBeat += (now - this.anchorTime) * this.lastBps;
    this.anchorTime = now;
    this.lastBps = this.clipStore.getClip().tempoBpm / 60;
  }

  private tick(): void {
    const clip = this.clipStore.getClip();
    const bps = clip.tempoBpm / 60;
    const now = this.synth.currentTime;
    const horizonBeats = this.anchorBeat + (now + SCHEDULE_AHEAD_SEC - this.anchorTime) * bps;
    const occurrences = notesStartingInBeatRange(
      clip.notes,
      this.scheduledUntilBeats,
      horizonBeats,
      clip.lengthBeats,
    );
    for (const { note, atBeat } of occurrences) {
      const when = this.anchorTime + (atBeat - this.anchorBeat) / bps;
      this.synth.playNote(note.pitch, beatsToSeconds(note.length, clip.tempoBpm), note.velocity, when);
    }
    if (horizonBeats > this.scheduledUntilBeats) this.scheduledUntilBeats = horizonBeats;
  }

  dispose(): void {
    this.stop();
  }
}
