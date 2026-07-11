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
});
