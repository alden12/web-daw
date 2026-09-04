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
import { Button } from "./controls/Button";
import { IconButton } from "./controls/IconButton";
import { Select } from "./controls/Select";

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
      {/* Record keeps its colour at rest: a red dot reads as "record" before you press it in a
          way a grey one does not, and it is the one control here you look for rather than at. */}
      <IconButton
        label="Record"
        tone="claude"
        toneAtRest
        size={compact ? "lg" : "md"}
        disabled={!started}
        active={recording}
        title={
          recording
            ? rec.status === "counting"
              ? "Counting in… (click to cancel)"
              : "Stop recording"
            : "Record a clip"
        }
        onClick={() => recorder.toggle()}
      >
        <span className={`w-3 h-3 rounded-full bg-current ${rec.status === "counting" ? "animate-pulse" : ""}`} />
      </IconButton>

      {rec.status === "error" && rec.error && (
        <span className="font-mono text-[10.5px] text-claude" role="alert">
          {rec.error}
        </span>
      )}

      {/* Grey while stopped, teal while playing: the accent says what the transport is doing
          rather than which button is the important one. */}
      <Button
        tone="you"
        active={isPlaying}
        disabled={!started}
        title={isPlaying ? "Stop" : "Play"}
        // Stopping while recording finalizes the take (recorder.stop also stops the
        // transport), so Stop never leaves a recording dangling.
        onClick={() => (recording ? void recorder.stop() : isPlaying ? scheduler.stop() : scheduler.play())}
        // Pulled 4px back towards the record button. The gap is measured between the two
        // boxes, but record has no visible box at rest, so the eye measures from the dot
        // instead and reads the same 12px as a hole. Closing it to 8px looks like 12.
        className={`font-mono min-w-18 -ml-1 ${compact ? "h-9" : ""}`}
      >
        {isPlaying ? "■ Stop" : "▶ Play"}
      </Button>
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
          className="w-14 font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-strong"
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
          className="w-12 font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-strong"
        />
        <span className="text-muted">/</span>
        <Select
          aria-label="Beat unit (denominator)"
          value={project.timeSignature.denominator}
          onChange={(e) =>
            dispatch({
              type: "setTimeSignature",
              numerator: project.timeSignature.numerator,
              denominator: Number(e.target.value),
            })
          }
          // The lone 13px dropdown in the app: it has to match the tempo/meter number inputs
          // beside it rather than the toolbar dropdowns it shares a component with.
          className="font-mono text-[13px]! text-strong"
        >
          {[2, 4, 8, 16].map((denominator) => (
            <option key={denominator} value={denominator}>
              {denominator}
            </option>
          ))}
        </Select>
      </label>
      <IconButton
        label="Metronome"
        tone="you"
        hidden={compact}
        active={metronome}
        title={metronome ? "Metronome on" : "Metronome off"}
        onClick={() => setMetronome(!metronome)}
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
      </IconButton>
    </div>
  );
}
