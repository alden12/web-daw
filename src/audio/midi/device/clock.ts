/**
 * The transport clock a MIDI device reads to place events on the tempo grid. It is
 * the minimal slice of the scheduler's beat bookkeeping that a device needs: whether
 * the transport is running, the audio-clock now, the beat length, and the continuous
 * (unlooped) beat at a given audio time. The Scheduler implements it; the AudioEngine
 * injects it into each device's factory. DOM-free (no Web Audio), like the rest of the
 * device layer.
 *
 * A stateless device (the tap/octavator) only reads `secondsPerBeat`. A generator (the
 * arpeggiator) uses `playing` + `continuousBeatAtTime` to lock its step grid to the
 * transport while playing, and free-runs from the first note when stopped.
 */
export interface TransportClock {
  /** Whether the transport is currently running. */
  readonly playing: boolean;
  /** The audio clock now (seconds). */
  readonly currentTime: number;
  /** Seconds per beat at the current tempo. */
  readonly secondsPerBeat: number;
  /** Continuous (unlooped) beats since playback start at audio-clock `time`; only meaningful while playing. */
  continuousBeatAtTime(time: number): number;
}
