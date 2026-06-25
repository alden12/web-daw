/**
 * The recording controller: orchestrates a take from arm to placement, and holds
 * the transient recording state the transport UI subscribes to (it is NOT part of
 * the project/edit stream - like selection and transport). The realtime sample
 * path lives in the AudioEngine (Web Audio); this coordinates engine + scheduler +
 * storage and then emits ONE durable edit (`addAudioTrack`) carrying the recorded
 * sample's content hash - the same edit audio import uses, so replay/persistence
 * come for free and stay deterministic (the capture is a side effect; the edit is
 * pure data).
 *
 * Count-in: before capture, schedule N bars of metronome clicks on the audio clock
 * and start the transport + capture when they finish, so the performer plays in
 * time. The count-in clicks fire regardless of the metronome toggle.
 */
import type { AudioEngine } from "../engine/AudioEngine";
import type { Scheduler } from "../sequencer/scheduler";
import type { ProjectStore } from "../project/projectStore";
import type { Dispatch } from "../commands/types";
import { newTrackId } from "../commands/ids";
import { audioStorageAvailable, putAudio } from "../audioStore";
import { encodeWav } from "./wav";

const BEATS_PER_BAR = 4; // matches the scheduler's metronome accent (4/4 for now)
const COUNT_IN_LEAD_SEC = 0.12; // small lead so the first click is not clipped

export type RecorderStatus = "idle" | "requesting" | "counting" | "recording" | "error";

export interface RecorderState {
  status: RecorderStatus;
  /** Selected input device id (null = system default). */
  deviceId: string | null;
  devices: { deviceId: string; label: string }[];
  /** Count-in length in bars (0 = none). */
  countInBars: number;
  error: string | null;
}

export class Recorder {
  private state: RecorderState = { status: "idle", deviceId: null, devices: [], countInBars: 1, error: null };
  private readonly listeners = new Set<() => void>();
  private countInTimer: ReturnType<typeof setTimeout> | null = null;
  private startBeat = 0;

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

  /** Arm the mic, run the count-in, then start the transport + capture. */
  async start(): Promise<void> {
    if (this.isActive) return;
    if (!this.engine.started) {
      this.set({ status: "error", error: "Start audio first" });
      return;
    }
    if (!audioStorageAvailable()) {
      this.set({ status: "error", error: "Recording needs audio storage (unavailable here)" });
      return;
    }
    try {
      this.set({ status: "requesting", error: null });
      await this.engine.enableInput(this.state.deviceId ?? undefined);
      await this.refreshDevices();

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
        const startTime = this.engine.startRecording();
        this.startBeat = this.scheduler.beatAtTime(startTime);
        this.set({ status: "recording" });
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

  /** Stop the take: assemble the WAV, store it, and place it on a new audio track. */
  async stop(): Promise<void> {
    if (this.countInTimer) {
      clearTimeout(this.countInTimer);
      this.countInTimer = null;
    }
    const wasCounting = this.state.status === "counting";
    const capture = wasCounting ? null : await this.engine.stopRecording();
    if (this.scheduler.isPlaying) this.scheduler.stop();
    this.engine.disableInput();
    this.set({ status: "idle" });
    if (!capture || capture.samples.length === 0) return;

    const { samples, sampleRate } = capture;
    const durationSec = samples.length / sampleRate;
    const fileId = await putAudio(encodeWav(samples, sampleRate));
    // Shift the take back by the estimated round-trip so it lands where it was
    // played (clamped to the start). A loopback calibration refines this later.
    const offsetBeats = this.engine.inputLatencySec() * (this.project.tempo / 60);
    const startBeat = Math.max(0, this.startBeat - offsetBeats);
    this.dispatch({
      type: "addAudioTrack",
      id: newTrackId(),
      fileId,
      name: this.nextTakeName(),
      durationSec,
      startBeat,
    });
  }

  /** "Take N", N being the next unused index among existing Take tracks. */
  private nextTakeName(): string {
    const used = this.project
      .getStructure()
      .tracks.map((t) => /^Take (\d+)$/.exec(t.name)?.[1])
      .filter((n): n is string => n !== undefined && n !== null)
      .map(Number);
    return `Take ${used.length ? Math.max(...used) + 1 : 1}`;
  }

  dispose(): void {
    if (this.countInTimer) clearTimeout(this.countInTimer);
    this.countInTimer = null;
    this.engine.disableInput();
  }
}
