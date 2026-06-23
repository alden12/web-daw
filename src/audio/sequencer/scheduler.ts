/**
 * The playback scheduler: the brief's "Tale of Two Clocks". A coarse setInterval
 * wakes every LOOKAHEAD_MS and schedules note onsets within the next
 * SCHEDULE_AHEAD_SEC for EVERY (non-muted) track, using the precise AudioContext
 * clock via each track's instrument.playNote. Playback loops at the project's
 * lengthBeats; tempo comes from the project.
 *
 * Beat bookkeeping is anchored as (anchorBeat at anchorTime), so a tempo change
 * mid-playback re-anchors and stays continuous.
 */
import type { AudioEngine } from '../engine/AudioEngine';
import type { ProjectStore } from '../project/projectStore';
import type { NoteEvent } from './types';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

/** Pure: seconds for a number of beats at a tempo. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Pure: note occurrences whose onset lands in [fromBeat, toBeat), accounting for
 * the clip looping the region [loopStart, loopStart+loopLen) every loopLen beats.
 * Continuous playback beat 0 maps to loopStart, so a note at absolute beat S fires
 * at iter*loopLen + (S - loopStart). Notes outside the loop region don't play.
 * `loopStart` defaults to 0 (loop the whole clip from the top).
 */
export function notesStartingInBeatRange(
  notes: NoteEvent[],
  fromBeat: number,
  toBeat: number,
  loopLen: number,
  loopStart = 0,
): { note: NoteEvent; atBeat: number }[] {
  const result: { note: NoteEvent; atBeat: number }[] = [];
  if (loopLen <= 0 || toBeat <= fromBeat) return result;
  const startIter = Math.floor(fromBeat / loopLen);
  const endIter = Math.ceil(toBeat / loopLen);
  for (let iter = startIter; iter <= endIter; iter++) {
    const base = iter * loopLen;
    for (const note of notes) {
      if (note.start < loopStart || note.start >= loopStart + loopLen) continue;
      const at = base + (note.start - loopStart);
      if (at >= fromBeat && at < toBeat) result.push({ note, atBeat: at });
    }
  }
  return result;
}

/**
 * Pure: continuous beats at which a single onset (e.g. an audio clip's start)
 * lands in [fromBeat, toBeat), accounting for the loop region [loopStart,
 * loopStart+loopLen). Onsets outside the region don't play. `loopStart` defaults
 * to 0.
 */
export function onsetsInBeatRange(
  startBeat: number,
  fromBeat: number,
  toBeat: number,
  loopLen: number,
  loopStart = 0,
): number[] {
  const result: number[] = [];
  if (loopLen <= 0 || toBeat <= fromBeat) return result;
  if (startBeat < loopStart || startBeat >= loopStart + loopLen) return result;
  const startIter = Math.floor(fromBeat / loopLen);
  const endIter = Math.ceil(toBeat / loopLen);
  for (let iter = startIter; iter <= endIter; iter++) {
    const at = iter * loopLen + (startBeat - loopStart);
    if (at >= fromBeat && at < toBeat) result.push(at);
  }
  return result;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  private anchorBeat = 0;
  private anchorTime = 0;
  private lastBps = 2;
  private scheduledUntilBeats = 0;

  private readonly engine: AudioEngine;
  private readonly project: ProjectStore;
  private readonly onStateChange?: (playing: boolean) => void;

  constructor(engine: AudioEngine, project: ProjectStore, onStateChange?: (playing: boolean) => void) {
    this.engine = engine;
    this.project = project;
    this.onStateChange = onStateChange;
  }

  get isPlaying(): boolean {
    return this.timer !== null;
  }

  play(): void {
    if (this.timer !== null || !this.engine.started) return;
    this.anchorTime = this.engine.currentTime;
    this.anchorBeat = 0;
    this.scheduledUntilBeats = 0;
    this.lastBps = this.project.tempo / 60;
    this.unsubscribe = this.project.subscribe(() => this.reanchor());
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
    for (const track of this.project.getTracks()) this.engine.getInstrument(track.id)?.allNotesOff();
    this.engine.stopAllAudio();
    this.onStateChange?.(false);
  }

  /** Looped position in beats for the playhead (sweeps the loop region); 0 when stopped. */
  getPositionBeats(): number {
    if (this.timer === null) return 0;
    const loopStart = this.project.loopStart;
    const loopLen = this.project.length - loopStart;
    const cont = this.anchorBeat + (this.engine.currentTime - this.anchorTime) * this.lastBps;
    return loopLen > 0 ? loopStart + (cont % loopLen) : 0;
  }

  private reanchor(): void {
    const now = this.engine.currentTime;
    this.anchorBeat += (now - this.anchorTime) * this.lastBps;
    this.anchorTime = now;
    this.lastBps = this.project.tempo / 60;
  }

  private tick(): void {
    const bpm = this.project.tempo;
    const bps = bpm / 60;
    const loopStart = this.project.loopStart;
    const loopLen = this.project.length - loopStart;
    const now = this.engine.currentTime;
    const horizonBeats = this.anchorBeat + (now + SCHEDULE_AHEAD_SEC - this.anchorTime) * bps;
    const fromBeats = this.scheduledUntilBeats;
    if (horizonBeats <= fromBeats) return;

    for (const track of this.project.getTracks()) {
      if (track.muted) continue;
      if (track.kind === 'instrument') {
        const instrument = this.engine.getInstrument(track.id);
        if (!instrument) continue;
        // Flatten the arrangement: each placement contributes its clip's notes
        // (windowed by offset/length) shifted to the placement's start.
        const events: NoteEvent[] = [];
        for (const p of track.placements) {
          const clip = track.clips.find((c) => c.id === p.clipId);
          if (!clip) continue;
          for (const n of clip.store.getClip().notes) {
            if (n.start < p.offset || n.start >= p.offset + p.length) continue;
            events.push({ ...n, start: p.startBeat + (n.start - p.offset) });
          }
        }
        for (const { note, atBeat } of notesStartingInBeatRange(events, fromBeats, horizonBeats, loopLen, loopStart)) {
          const when = this.anchorTime + (atBeat - this.anchorBeat) / bps;
          instrument.playNote(note.pitch, beatsToSeconds(note.length, bpm), note.velocity, when);
        }
      } else {
        // Each audio placement is a single onset at its start (plays the buffer).
        for (const p of track.placements) {
          const clip = track.clips.find((c) => c.id === p.clipId);
          if (!clip) continue;
          for (const atBeat of onsetsInBeatRange(p.startBeat, fromBeats, horizonBeats, loopLen, loopStart)) {
            const when = this.anchorTime + (atBeat - this.anchorBeat) / bps;
            this.engine.scheduleAudioClip(track.id, clip, when);
          }
        }
      }
    }
    this.scheduledUntilBeats = horizonBeats;
  }

  dispose(): void {
    this.stop();
  }
}
