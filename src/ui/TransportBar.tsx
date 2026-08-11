/**
 * Transport controls: play/stop the scheduler, edit the project tempo + time
 * signature, and toggle the metronome. Tempo and meter are read/written through the
 * project store, so MCP and the UI stay in sync; the metronome is a transient playback
 * preference (persisted locally, pushed to the scheduler), not part of the project/edit stream.
 */
import { useEffect } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import { useProject } from "../audio/project/useProject";
import { TEMPO_BPM_RANGE, TIME_SIGNATURE_NUMERATOR_RANGE } from "../audio/project/schema";
import { useRecorder } from "./useRecorder";
import { usePersistentBoolean } from "./usePersistent";

export function TransportBar({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  isPlaying,
  started,
  compact = false,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
  /**
   * Touch layout (MOBILE-1): keep only what you reach for mid-idea - record and play -
   * and let the shell's ⋮ carry tempo, meter and the metronome, which frees the top bar
   * for undo/redo. The shell owns all three outright while compact, so each has one
   * writer, not two.
   */
  compact?: boolean;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const [metronome, setMetronome] = usePersistentBoolean("web-daw:metronome", false);

  // The scheduler reads this flag each tick; keep it in sync with the preference. While
  // compact the shell's ⋮ owns the metronome instead, so this stands down rather than
  // having two writers push the same preference at the same object.
  useEffect(() => {
    if (compact) return;
    scheduler.setMetronomeEnabled(metronome);
  }, [scheduler, metronome, compact]);

  const recording = rec.status === "recording" || rec.status === "counting";

  return (
    <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
      <button
        type="button"
        disabled={!started}
        aria-label="Record"
        aria-pressed={recording}
        title={
          recording
            ? rec.status === "counting"
              ? "Counting in… (click to cancel)"
              : "Stop recording"
            : "Record a clip"
        }
        onClick={() => recorder.toggle()}
        className={`inline-flex items-center justify-center rounded-lg border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          compact ? "w-9 h-9" : "w-8 h-8"
        } ${
          recording
            ? "text-claude bg-claude/15 border-claude/55"
            : "text-claude/80 bg-card border-line hover:border-claude/55"
        }`}
      >
        <span className={`w-3 h-3 rounded-full bg-current ${rec.status === "counting" ? "animate-pulse" : ""}`} />
      </button>

      {rec.status === "error" && rec.error && (
        <span className="font-mono text-[10.5px] text-claude" role="alert">
          {rec.error}
        </span>
      )}

      <button
        type="button"
        disabled={!started}
        // Stopping while recording finalizes the take (recorder.stop also stops the
        // transport), so Stop never leaves a recording dangling.
        onClick={() => (recording ? void recorder.stop() : isPlaying ? scheduler.stop() : scheduler.play())}
        className={`font-mono text-[13px] min-w-18 px-3 rounded-lg text-you bg-you/15 border border-you/45 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          compact ? "h-9" : "py-1.5"
        }`}
      >
        {isPlaying ? "■ Stop" : "▶ Play"}
      </button>
      {/* The word labels drop below `sm`: on a phone the transport is pinned above every
          view (MOBILE-1) and has to fit 390px without clipping. The fields keep their
          `aria-label` / `title`, so nothing is lost to assistive tech. */}
      <label hidden={compact} className="inline-flex items-center gap-2 font-mono text-xs text-muted" title="Tempo">
        <span className="max-sm:hidden">Tempo</span>
        <input
          type="number"
          min={TEMPO_BPM_RANGE.min}
          max={TEMPO_BPM_RANGE.max}
          value={project.tempoBpm}
          aria-label="Tempo (BPM)"
          onChange={(e) => dispatch({ type: "setTempo", bpm: Number(e.target.value) })}
          className="w-14 font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-bright"
        />
        <span className="max-sm:hidden">BPM</span>
      </label>
      <label
        hidden={compact}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted"
        title="Time signature"
      >
        <span className="max-sm:hidden">Meter</span>
        <input
          type="number"
          min={TIME_SIGNATURE_NUMERATOR_RANGE.min}
          max={TIME_SIGNATURE_NUMERATOR_RANGE.max}
          aria-label="Beats per bar (numerator)"
          value={project.timeSignature.numerator}
          onChange={(e) =>
            dispatch({
              type: "setTimeSignature",
              numerator: Number(e.target.value),
              denominator: project.timeSignature.denominator,
            })
          }
          className="w-12 font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-bright"
        />
        <span className="text-muted">/</span>
        <select
          aria-label="Beat unit (denominator)"
          value={project.timeSignature.denominator}
          onChange={(e) =>
            dispatch({
              type: "setTimeSignature",
              numerator: project.timeSignature.numerator,
              denominator: Number(e.target.value),
            })
          }
          className="font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-bright cursor-pointer"
        >
          {[2, 4, 8, 16].map((denominator) => (
            <option key={denominator} value={denominator}>
              {denominator}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        hidden={compact}
        aria-label="Metronome"
        aria-pressed={metronome}
        title={metronome ? "Metronome on" : "Metronome off"}
        onClick={() => setMetronome(!metronome)}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border cursor-pointer ${
          metronome ? "text-you bg-you/15 border-you/45" : "text-muted bg-card border-line hover:text-ink"
        }`}
      >
        {/* a small metronome: trapezoid body + pendulum */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 2 H10 L12.5 14 H3.5 Z" />
          <line x1="4.3" y1="10" x2="11.7" y2="10" />
          <line x1="8" y1="10" x2="11" y2="3.5" />
        </svg>
      </button>
    </div>
  );
}
