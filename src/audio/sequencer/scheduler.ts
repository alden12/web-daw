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
import { GRID, type NoteEvent } from './types';

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

/**
 * Pure: a placement's clip notes tiled across its window, in arrangement-relative
 * beats (0 = the placement start). A clip of `clipLen` beats loops to fill the
 * window: a window that fits within the clip plays once (a trim), a longer window
 * repeats the pattern. `offset` is the phase into the loop the window begins at.
 */
export function tileClipNotes(
  notes: NoteEvent[],
  clipLen: number,
  offset: number,
  length: number,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  if (clipLen <= 0) return out;
  for (const note of notes) {
    if (note.start < 0 || note.start >= clipLen) continue;
    let phase = (note.start - offset) % clipLen;
    if (phase < 0) phase += clipLen;
    for (let tau = phase; tau < length; tau += clipLen) out.push({ ...note, start: tau });
  }
  return out;
}

/**
 * Pure: metronome clicks (whole beats) whose continuous onset lands in
 * [fromBeat, toBeat). Continuous beat 0 = playback start = the loop's start, so a
 * continuous beat `b` maps to the musical beat `loopStart + (b mod loopLen)`; the
 * click is accented on each bar (musical beat divisible by `beatsPerBar`). Matches
 * the note scheduler's half-open range so clicks and notes line up tick to tick.
 */
export function metronomeClicksInBeatRange(
  fromBeat: number,
  toBeat: number,
  loopStart: number,
  loopLen: number,
  beatsPerBar: number,
): { atBeat: number; accent: boolean }[] {
  const out: { atBeat: number; accent: boolean }[] = [];
  if (loopLen <= 0 || beatsPerBar <= 0 || toBeat <= fromBeat) return out;
  for (let b = Math.ceil(fromBeat); b < toBeat; b++) {
    const musical = loopStart + (((b % loopLen) + loopLen) % loopLen);
    out.push({ atBeat: b, accent: musical % beatsPerBar === 0 });
  }
  return out;
}

// Beats per bar for the metronome's bar accent. A project-level time signature is
// a future feature; 4/4 matches the timeline ruler's DEFAULT_BEATS_PER_BAR.
const BEATS_PER_BAR = 4;

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** When true, the transport schedules a metronome click on every beat. */
  private metronomeEnabled = false;

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

  /** Toggle the metronome click (read by `tick` each lookahead pass). */
  setMetronomeEnabled(on: boolean): void {
    this.metronomeEnabled = on;
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

  /**
   * Looped beat position at an arbitrary audio-clock `time`, using the current
   * anchor (valid while playing). Recording uses this to map the capture's start
   * time to the arrangement beat where the take should land.
   */
  beatAtTime(time: number): number {
    const loopStart = this.project.loopStart;
    const loopLen = this.project.length - loopStart;
    const cont = this.anchorBeat + (time - this.anchorTime) * this.lastBps;
    return loopLen > 0 ? loopStart + (cont % loopLen) : cont;
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

    if (this.metronomeEnabled) {
      for (const { atBeat, accent } of metronomeClicksInBeatRange(fromBeats, horizonBeats, loopStart, loopLen, BEATS_PER_BAR)) {
        const when = this.anchorTime + (atBeat - this.anchorBeat) / bps;
        this.engine.scheduleClick(when, accent);
      }
    }

    for (const track of this.project.getTracks()) {
      if (track.muted) continue;
      // A launched clip overrides the arrangement: play it as one full-region
      // placement, so the existing tiling loops it over the transport.
      const placements = track.launchedClipId
        ? [{ id: '__launch', clipId: track.launchedClipId, startBeat: loopStart, offset: 0, length: loopLen }]
        : track.placements;
      if (track.kind === 'instrument') {
        const instrument = this.engine.getInstrument(track.id);
        if (!instrument) continue;
        // Flatten the arrangement: each placement contributes its clip's notes,
        // tiled across its window (looping a clip whose window outruns it) and
        // shifted to the placement's start on the arrangement.
        const events: NoteEvent[] = [];
        for (const p of placements) {
          const clip = track.clips.find((c) => c.id === p.clipId);
          if (!clip) continue;
          const c = clip.store.getClip();
          for (const n of tileClipNotes(c.notes, c.lengthBeats, p.offset, p.length)) {
            events.push({ ...n, start: p.startBeat + n.start });
          }
        }
        for (const { note, atBeat } of notesStartingInBeatRange(events, fromBeats, horizonBeats, loopLen, loopStart)) {
          const when = this.anchorTime + (atBeat - this.anchorBeat) / bps;
          instrument.playNote(note.pitch, beatsToSeconds(note.length, bpm), note.velocity, when);
        }
      } else {
        // Each audio placement triggers the clip's loop region at its start,
        // re-triggering every region-length so a placement longer than the region
        // repeats (loops) it; the engine plays exactly that slice of the buffer.
        for (const p of placements) {
          const clip = track.clips.find((c) => c.id === p.clipId);
          if (!clip) continue;
          const regionSec = (clip.loopEndSec ?? clip.durationSec) - (clip.loopStartSec ?? 0);
          const clipBeats = regionSec > 0 ? (regionSec * bpm) / 60 : Infinity;
          for (let tau = 0; tau < p.length; tau += Math.max(GRID, clipBeats)) {
            for (const atBeat of onsetsInBeatRange(p.startBeat + tau, fromBeats, horizonBeats, loopLen, loopStart)) {
              const when = this.anchorTime + (atBeat - this.anchorBeat) / bps;
              // Cut playback at the next loop boundary so a region that overruns the
              // loop (its length doesn't divide loopLen) is truncated instead of
              // overlapping the loop's restart (the double-trigger bug).
              const maxBeats = (Math.floor(atBeat / loopLen) + 1) * loopLen - atBeat;
              this.engine.scheduleAudioClip(track.id, clip, when, maxBeats / bps);
            }
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
