/**
 * Routes live note events - from the computer keyboard or a hardware MIDI device -
 * to the selected track's instrument and to the recorder (which captures only while
 * a MIDI take is recording). One place owns three subtleties so every input source
 * gets them for free:
 *
 *  - A held note releases on the instrument it *started* on, so changing the track
 *    selection mid-press does not leave a voice ringing on the new instrument.
 *  - The sustain pedal (MIDI CC64) defers note-offs until the pedal lifts. It is
 *    handled generically here rather than per-instrument, so the pedal works for
 *    every instrument without any of them knowing a pedal exists.
 *  - Velocity (0..1) passes straight through; the computer keyboard omits it and
 *    the instrument/recorder defaults apply.
 *
 * Structural dependencies (EngineLike/ProjectLike/RecorderLike) keep this decoupled
 * from the concrete AudioEngine/ProjectStore/Recorder and cheap to unit-test.
 */

export interface InstrumentTarget {
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
}
export interface EngineLike {
  getInstrument(trackId: string): InstrumentTarget | undefined;
}
export interface ProjectLike {
  readonly selectedId: string | null;
}
export interface RecorderLike {
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
}

export class LiveNotes {
  /** midi note -> the track id whose instrument it was triggered on. */
  private readonly held = new Map<number, string>();
  /** notes whose key is released but still sounding because the pedal is down. */
  private readonly sustained = new Set<number>();
  private sustainDown = false;
  private readonly engine: EngineLike;
  private readonly project: ProjectLike;
  private readonly recorder: RecorderLike;

  constructor(engine: EngineLike, project: ProjectLike, recorder: RecorderLike) {
    this.engine = engine;
    this.project = project;
    this.recorder = recorder;
  }

  noteOn(midi: number, velocity?: number): void {
    const trackId = this.project.selectedId;
    if (!trackId) return;
    // Re-pressing a pedal-sustained note: close the old sounding note first (so the
    // recording keeps both), then start the new press fresh.
    if (this.sustained.has(midi)) this.release(midi);
    this.held.set(midi, trackId);
    this.engine.getInstrument(trackId)?.noteOn(midi, velocity);
    this.recorder.noteOn(midi, velocity);
  }

  noteOff(midi: number): void {
    // While the pedal is down, keep the note sounding and release it when it lifts.
    if (this.sustainDown && this.held.has(midi)) {
      this.sustained.add(midi);
      return;
    }
    this.release(midi);
  }

  /** Sustain pedal (CC64). Lifting it flushes every note the pedal was holding. */
  setSustain(down: boolean): void {
    if (down === this.sustainDown) return;
    this.sustainDown = down;
    if (!down) for (const midi of [...this.sustained]) this.release(midi);
  }

  /** Release everything (e.g. when live input is turned off). */
  releaseAll(): void {
    for (const midi of [...this.held.keys()]) this.release(midi);
    this.sustainDown = false;
  }

  private release(midi: number): void {
    // Release on the instrument the note started on, not the currently-selected one.
    const trackId = this.held.get(midi) ?? this.project.selectedId;
    this.held.delete(midi);
    this.sustained.delete(midi);
    if (!trackId) return;
    this.engine.getInstrument(trackId)?.noteOff(midi);
    this.recorder.noteOff(midi);
  }
}
