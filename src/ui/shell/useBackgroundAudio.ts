/**
 * What happens to audio when a touch device hides the app (DAW-33).
 *
 * **Two separate things go wrong when a phone is minimised, and only one of them is the
 * transport.**
 *
 * The transport half: a hidden page has its timers throttled to roughly a wake a second, and the
 * scheduler is a timer. It wakes, finds the window it should have covered already gone past, and
 * skips it (DAW-32), so a minimised phone plays a sparse, arrhythmic version of the project to
 * nobody. There is nothing worth preserving in that, so hiding stops it.
 *
 * The louder half is the context. **A hidden page does not get a hidden audio thread, it gets a
 * starved one** - hardware still pulling samples at 48kHz from a graph whose main thread is
 * asleep - so it underruns and repeats whatever it last had. That is the gargling an idle
 * backgrounded app makes with nothing playing, and no amount of stopping the transport touches
 * it, because the transport is not what is making the sound. Suspending the context is what
 * actually stops the render, and it freezes `currentTime` with it, so there is no accumulated
 * gap to race across on the way back in.
 *
 * Order matters: stop first, then suspend. Suspending under a running transport would leave it
 * anchored to a clock that has stopped moving, which is a worse state than either.
 *
 * **Touch only.** A desktop tab that is playing audio is largely exempt from timer throttling, so
 * backgrounding one and carrying on listening works properly and is a thing people do
 * deliberately.
 */
import { useEffect } from "react";
import type { AudioEngine } from "../../audio/engine/AudioEngine";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Recorder } from "../../audio/recording/recorder";

export function useBackgroundAudio({
  engine,
  scheduler,
  recorder,
  /** False on desktop, where backgrounded playback works and is wanted. */
  enabled,
}: {
  engine: AudioEngine;
  scheduler: Scheduler;
  recorder: Recorder;
  enabled: boolean;
}): void {
  useEffect(() => {
    if (!enabled) return;

    const onHidden = async () => {
      // A take in flight is finalised rather than dropped, the same as pressing stop or space -
      // and awaited, so the context is still running underneath the capture that is being closed.
      if (scheduler.isPlaying) {
        if (recorder.isActive) await recorder.stop();
        else scheduler.stop();
      }
      // Re-checked after the await, because finalising a take is not instant: a quick
      // hide-then-show can land the resume before this suspend, and suspending a page nobody is
      // hiding any more leaves a silent app until the next touch picks it back up.
      if (document.visibilityState !== "hidden") return;
      await engine.suspend();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void onHidden();
      else void engine.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, engine, scheduler, recorder]);

  /**
   * Coming back to an installed app does not always count as the gesture iOS wants before it will
   * let a context run again, and the failure is silent: every control works and nothing makes a
   * sound. So the first touch after a resume that did not take tries again. This also covers a
   * context the OS parked for its own reasons (a phone call), which does not lift on its own.
   *
   * A no-op in every other case: a context that has not been started yet reads as `"closed"`, and
   * `resume` ignores both that and a running one.
   */
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = () => {
      if (engine.contextState !== "running") void engine.resume();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [enabled, engine]);
}
