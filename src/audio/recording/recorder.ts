/**
 * The recording controller: orchestrates a take from arm to placement, and holds
 * the transient recording state the transport UI subscribes to (it is NOT part of
 * the project/edit stream - like selection and transport). It records into the
 * armed track, or - if nothing is explicitly armed - the selected track; the
 * target's kind picks the mode: an audio track (or none) captures the mic, an
 * instrument track captures live MIDI notes.
 *
 * The realtime sample path lives in the AudioEngine (Web Audio); MIDI notes are
 * captured here via noteOn/noteOff stamped against arrangement beats. Either way
 * the take ends in ONE durable edit (`addAudioTrack`/`addAudioClip` or
 * `addNoteClip`) of pure data, so replay/persistence come for free and stay
 * deterministic (the capture is a side effect; the edit is pure data). A take
 * punches in over the lane - its clip replaces whatever it overlaps.
 *
 * Count-in: before capture, schedule N bars of metronome clicks on the audio clock
 * and start the transport + capture when they finish, so the performer plays in
 * time. The count-in clicks fire regardless of the metronome toggle.
 */
import type { AudioEngine } from "../engine/AudioEngine";
import type { Scheduler } from "../sequencer/scheduler";
import type { ProjectStore } from "../project/projectStore";
import type { Dispatch } from "../commands/types";
import { newClipId, newNoteId, newPlacementId, newTrackId } from "../commands/ids";
import { audioStorageAvailable, putAudio } from "../audioStore";
import { GRID, type NoteEvent } from "../sequencer/types";
import { encodeWav } from "./wav";

const BEATS_PER_BAR = 4; // matches the scheduler's metronome accent (4/4 for now)
const COUNT_IN_LEAD_SEC = 0.12; // small lead so the first click is not clipped

/** What the next take captures: audio from the mic, or MIDI notes played live. */
type CaptureMode = "audio" | "midi";

/** A note still held down mid-take (its onset beat, awaiting a note-off to close it). */
interface HeldNote {
  startBeat: number;
  velocity: number;
}

/**
 * A snapshot of the MIDI take in flight, for live display in the piano roll. Beats
 * are absolute (looped) arrangement beats, so they line up with the playhead.
 * `held` notes have no end yet - the roll grows them to the playhead each frame.
 */
export interface LiveTake {
  trackId: string;
  captured: { pitch: number; startBeat: number; endBeat: number }[];
  held: { pitch: number; startBeat: number }[];
}

export type RecorderStatus = "idle" | "requesting" | "counting" | "recording" | "error";

export interface RecorderState {
  status: RecorderStatus;
  /** Selected input device id (null = system default). */
  deviceId: string | null;
  devices: { deviceId: string; label: string }[];
  /** Count-in length in bars (0 = none). */
  countInBars: number;
  /** The audio track armed to receive the take; null = record into a new track. */
  armedTrackId: string | null;
  /** The MIDI take in flight (for live display in the roll); null when not capturing MIDI. */
  take: LiveTake | null;
  error: string | null;
}

export class Recorder {
  private state: RecorderState = { status: "idle", deviceId: null, devices: [], countInBars: 1, armedTrackId: null, take: null, error: null };
  private readonly listeners = new Set<() => void>();
  private countInTimer: ReturnType<typeof setTimeout> | null = null;
  private startBeat = 0;
  // The take in flight: what it captures and where it lands. For MIDI, notes are
  // accumulated live - `held` is keyed by pitch (a note awaiting its note-off);
  // `captured` holds the finished notes (absolute arrangement beats).
  private mode: CaptureMode = "audio";
  private targetTrackId: string | null = null;
  private readonly held = new Map<number, HeldNote>();
  private captured: { pitch: number; velocity: number; startBeat: number; endBeat: number }[] = [];

  private readonly engine: AudioEngine;
  private readonly scheduler: Scheduler;
  private readonly project: ProjectStore;
  private readonly dispatch: Dispatch;

  constructor(engine: AudioEngine, scheduler: Scheduler, project: ProjectStore, dispatch: Dispatch) {
    this.engine = engine;
    this.scheduler = scheduler;
    this.project = project;
    this.dispatch = dispatch;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getState(): RecorderState {
    return this.state;
  }
  private set(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get isActive(): boolean {
    return this.state.status === "counting" || this.state.status === "recording";
  }

  setDevice(deviceId: string | null): void {
    this.set({ deviceId });
  }
  setCountInBars(bars: number): void {
    this.set({ countInBars: Math.max(0, bars) });
  }
  /** Arm an audio track to receive the next take (null = a fresh track). */
  setArmedTrack(trackId: string | null): void {
    this.set({ armedTrackId: trackId });
  }
  /** Arm a track and start (or, if already recording, stop) - the clip-rail trigger. */
  recordInto(trackId: string): void {
    if (this.isActive) {
      void this.stop();
      return;
    }
    this.set({ armedTrackId: trackId });
    void this.start();
  }

  /** Refresh the device list (labels populate once mic permission is granted). */
  async refreshDevices(): Promise<void> {
    try {
      this.set({ devices: await this.engine.listInputDevices() });
    } catch {
      // enumeration unavailable; leave the list as-is
    }
  }

  toggle(): void {
    if (this.isActive) void this.stop();
    else void this.start();
  }

  /**
   * Run the count-in, then start the transport + capture. The take lands in the
   * armed track, or - if nothing is explicitly armed - the selected track. An
   * instrument target records MIDI (no mic); an audio target (or no target)
   * records audio.
   */
  async start(): Promise<void> {
    if (this.isActive) return;
    if (!this.engine.started) {
      this.set({ status: "error", error: "Start audio first" });
      return;
    }
    const targetId = this.state.armedTrackId ?? this.project.selectedId;
    const target = targetId ? this.project.getTrack(targetId) : undefined;
    this.mode = target?.kind === "instrument" ? "midi" : "audio";
    this.targetTrackId = targetId ?? null;
    if (this.mode === "audio" && !audioStorageAvailable()) {
      this.set({ status: "error", error: "Recording needs audio storage (unavailable here)" });
      return;
    }
    try {
      this.set({ status: "requesting", error: null });
      if (this.mode === "audio") {
        await this.engine.enableInput(this.state.deviceId ?? undefined);
        await this.refreshDevices();
      }

      const interval = 60 / this.project.tempo; // seconds per beat
      const countBeats = this.state.countInBars * BEATS_PER_BAR;
      const t0 = this.engine.currentTime + COUNT_IN_LEAD_SEC;
      for (let i = 0; i < countBeats; i++) {
        this.engine.scheduleClick(t0 + i * interval, i % BEATS_PER_BAR === 0);
      }

      const beginCapture = () => {
        this.countInTimer = null;
        if (this.state.status === "idle") return; // stopped during the count-in
        if (!this.scheduler.isPlaying) this.scheduler.play();
        if (this.mode === "audio") {
          this.startBeat = this.scheduler.beatAtTime(this.engine.startRecording());
        } else {
          this.held.clear();
          this.captured = [];
          this.startBeat = this.scheduler.beatAtTime(this.engine.currentTime);
        }
        this.set({ status: "recording", take: this.mode === "midi" ? this.liveTake() : null });
      };

      if (countBeats > 0) {
        this.set({ status: "counting" });
        this.countInTimer = setTimeout(beginCapture, countBeats * interval * 1000);
      } else {
        beginCapture();
      }
    } catch {
      this.engine.disableInput();
      this.set({ status: "error", error: "Could not access the microphone" });
    }
  }

  /**
   * Capture a live note-on while a MIDI take is recording (a no-op otherwise). The
   * onset is stamped against arrangement beats now; the matching note-off closes it.
   */
  noteOn(midi: number, velocity = 0.8): void {
    if (this.state.status !== "recording" || this.mode !== "midi") return;
    this.held.set(midi, { startBeat: this.scheduler.beatAtTime(this.engine.currentTime), velocity });
    this.set({ take: this.liveTake() });
  }

  /** Close a held note at the current beat (a no-op if it was not being captured). */
  noteOff(midi: number): void {
    if (this.mode !== "midi") return;
    const note = this.held.get(midi);
    if (!note) return;
    this.held.delete(midi);
    const endBeat = this.scheduler.beatAtTime(this.engine.currentTime);
    this.captured.push({ pitch: midi, velocity: note.velocity, startBeat: note.startBeat, endBeat });
    if (this.state.status === "recording") this.set({ take: this.liveTake() });
  }

  /** A snapshot of the take in flight (absolute beats), for the roll's live overlay. */
  private liveTake(): LiveTake | null {
    if (!this.targetTrackId) return null;
    return {
      trackId: this.targetTrackId,
      captured: this.captured.map((n) => ({ pitch: n.pitch, startBeat: n.startBeat, endBeat: n.endBeat })),
      held: [...this.held].map(([pitch, n]) => ({ pitch, startBeat: n.startBeat })),
    };
  }

  /** Stop the take and place it: a WAV on an audio track, or a note clip on the MIDI track. */
  async stop(): Promise<void> {
    if (this.countInTimer) {
      clearTimeout(this.countInTimer);
      this.countInTimer = null;
    }
    const wasCounting = this.state.status === "counting";
    if (this.mode === "midi") {
      this.finishMidiTake(wasCounting);
    } else {
      await this.finishAudioTake(wasCounting);
    }
    // The arm is one-shot: the next take defaults back to the selected track.
    this.set({ armedTrackId: null });
    this.targetTrackId = null;
  }

  /** Assemble the captured WAV, store it, and place it (punching in over the lane). */
  private async finishAudioTake(wasCounting: boolean): Promise<void> {
    const capture = wasCounting ? null : await this.engine.stopRecording();
    if (this.scheduler.isPlaying) this.scheduler.stop();
    this.engine.disableInput();
    this.set({ status: "idle", take: null });
    if (!capture || capture.samples.length === 0) return;

    const { samples, sampleRate } = capture;
    const durationSec = samples.length / sampleRate;
    const fileId = await putAudio(encodeWav(samples, sampleRate));
    // Shift the take back by the estimated round-trip so it lands where it was
    // played (clamped to the start). A loopback calibration refines this later.
    const offsetBeats = this.engine.inputLatencySec() * (this.project.tempo / 60);
    const startBeat = Math.max(0, this.startBeat - offsetBeats);
    const name = this.nextTakeName();

    // Record into the target audio track if one is set (and still valid); otherwise
    // create a fresh track for the take.
    const target = this.targetTrackId ? this.project.getTrack(this.targetTrackId) : undefined;
    if (target && target.kind === "audio") {
      this.dispatch({ type: "addAudioClip", trackId: target.id, id: newClipId(), placementId: newPlacementId(), fileId, name, durationSec, startBeat });
    } else {
      this.dispatch({ type: "addAudioTrack", id: newTrackId(), fileId, name, durationSec, startBeat });
    }
  }

  /** Close any held notes, then place the captured notes as a new clip on the MIDI track. */
  private finishMidiTake(wasCounting: boolean): void {
    const stopBeat = this.scheduler.beatAtTime(this.engine.currentTime);
    if (this.scheduler.isPlaying) this.scheduler.stop();
    this.set({ status: "idle", take: null });
    if (wasCounting) {
      this.held.clear();
      this.captured = [];
      return;
    }
    // Close notes still held at stop (give them a minimum sounding length).
    for (const [pitch, note] of this.held) {
      this.captured.push({ pitch, velocity: note.velocity, startBeat: note.startBeat, endBeat: Math.max(stopBeat, note.startBeat + GRID) });
    }
    this.held.clear();
    const captured = this.captured;
    this.captured = [];

    const target = this.targetTrackId ? this.project.getTrack(this.targetTrackId) : undefined;
    if (!captured.length || !target || target.kind !== "instrument") return;

    // Anchor the clip at the bar the take began in, so notes keep their groove
    // relative to the bar and the clip lines up with the grid. The clip is sized
    // up to whole bars to cover the last note.
    const clipStart = Math.max(0, Math.floor(this.startBeat / BEATS_PER_BAR) * BEATS_PER_BAR);
    const notes: NoteEvent[] = captured.map((n) => ({
      id: newNoteId(),
      pitch: n.pitch,
      start: Math.max(0, n.startBeat - clipStart),
      length: Math.max(GRID, n.endBeat - n.startBeat),
      velocity: n.velocity,
    }));
    const span = Math.max(...notes.map((n) => n.start + n.length));
    const lengthBeats = Math.max(BEATS_PER_BAR, Math.ceil(span / BEATS_PER_BAR) * BEATS_PER_BAR);
    this.dispatch({ type: "addNoteClip", trackId: target.id, id: newClipId(), placementId: newPlacementId(), name: this.nextTakeName(), notes, lengthBeats, startBeat: clipStart });
  }

  /** "Take N", N being the next unused index among existing Take tracks/clips. */
  private nextTakeName(): string {
    const nums: number[] = [];
    const add = (name: string) => {
      const m = /^Take (\d+)$/.exec(name);
      if (m) nums.push(Number(m[1]));
    };
    for (const t of this.project.getStructure().tracks) {
      add(t.name);
      for (const c of t.clips) add(c.name);
    }
    return `Take ${nums.length ? Math.max(...nums) + 1 : 1}`;
  }

  dispose(): void {
    if (this.countInTimer) clearTimeout(this.countInTimer);
    this.countInTimer = null;
    this.engine.disableInput();
  }
}
