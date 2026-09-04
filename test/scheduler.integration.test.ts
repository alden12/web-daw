import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../src/audio/sequencer/scheduler";
import { ProjectStore } from "../src/audio/project/projectStore";

describe("Scheduler integration (mocked clock)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("schedules every track's notes at distinct times, not all at once", () => {
    let clock = 0;
    const calls: { trackId: string; midi: number; when: number }[] = [];
    const instByTrack = new Map<string, { id: string }>();

    const engine = {
      get started() {
        return true;
      },
      get currentTime() {
        return clock;
      },
      getNoteTarget(id: string) {
        if (!instByTrack.has(id)) instByTrack.set(id, { id });
        return {
          playNote: (midi: number, _dur: number, _vel: number, when: number) => calls.push({ trackId: id, midi, when }),
          allNotesOff: () => {},
        };
      },
      scheduleAudioClip: () => {},
      stopAllAudio: () => {},
    };

    const project = new ProjectStore(false);
    project.setTempo(120); // bps = 2
    const a = project.addTrack("subtractive", { name: "A" });
    project.getClipStore(a.id)!.addNote({ pitch: 60, start: 0 });
    project.getClipStore(a.id)!.addNote({ pitch: 62, start: 4 });
    const b = project.addTrack("fm", { name: "B" });
    project.getClipStore(b.id)!.addNote({ pitch: 36, start: 2 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduler = new Scheduler(engine as any, project);
    scheduler.play();

    // Advance ~5 seconds in 25ms steps, moving the audio clock with the timers.
    for (let i = 0; i < 200; i++) {
      clock += 0.025;
      vi.advanceTimersByTime(25);
    }
    scheduler.stop();

    const a60 = calls.find((c) => c.trackId === a.id && c.midi === 60);
    const a62 = calls.find((c) => c.trackId === a.id && c.midi === 62);
    const b36 = calls.find((c) => c.trackId === b.id && c.midi === 36);

    expect(a60).toBeTruthy();
    expect(a62).toBeTruthy();
    expect(b36).toBeTruthy();
    // beat 0 ~ 0s, beat 2 ~ 1s, beat 4 ~ 2s at 120bpm
    expect(a60!.when).toBeCloseTo(0, 1);
    expect(b36!.when).toBeCloseTo(1, 1);
    expect(a62!.when).toBeCloseTo(2, 1);
  });

  /**
   * DAW-32. A tick that does not run for a while leaves `scheduledUntilBeats` behind while the
   * audio clock carries on, so the next tick's window used to span the whole stall - and every
   * overdue note in it was scheduled at a time already past, which Web Audio plays immediately.
   * A phone reported it as "jumping through time, like it's catching up".
   *
   * Mobile is only where it shows: timers are throttled hard there, an installed PWA backgrounds
   * when you switch apps, and a phone stalls the main thread over things a laptop shrugs off.
   */
  it("skips a stalled window rather than firing all of it at once", () => {
    let clock = 0;
    const calls: { midi: number; when: number }[] = [];
    const engine = {
      get started() {
        return true;
      },
      get currentTime() {
        return clock;
      },
      getNoteTarget: () => ({
        playNote: (midi: number, _dur: number, _vel: number, when: number) => calls.push({ midi, when }),
        allNotesOff: () => {},
      }),
      scheduleAudioClip: () => {},
      stopAllAudio: () => {},
    };

    const project = new ProjectStore(false);
    project.setTempo(120); // 2 beats per second
    project.setLength(16);
    const track = project.addTrack("subtractive", { name: "A" });
    // One note per beat across the stall, so "was the gap replayed" has an unambiguous answer.
    [1, 2, 3, 4, 5, 6].forEach((beat) => project.getClipStore(track.id)!.addNote({ pitch: 60 + beat, start: beat }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduler = new Scheduler(engine as any, project);
    scheduler.play();

    // Three seconds pass with the timer never firing: the app was in the background, or the
    // main thread was busy. The audio clock does not stop for either.
    clock += 3;
    vi.advanceTimersByTime(25);
    scheduler.stop();

    // Beats 1 to 5 came due during the stall and are simply gone. The defect scheduled them at
    // a time already past, which Web Audio plays at once: backed out, this assertion reports all
    // six notes at `when` 3, which is the burst as a phone hears it.
    //
    // Beat 6 is 3s in and inside the lookahead from t=3, so playback picks straight back up
    // rather than going silent until the loop comes round.
    expect(
      calls.map((call) => call.midi),
      `scheduled: ${JSON.stringify(calls)}`,
    ).toEqual([66]);
    expect(calls[0].when, "and at its own time, not bunched onto the present").toBeCloseTo(3, 2);
  });
});
