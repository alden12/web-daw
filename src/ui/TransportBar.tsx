/**
 * Transport controls: play/stop the scheduler, edit the project tempo, and toggle
 * the metronome. Tempo is read/written through the project store, so MCP and the UI
 * stay in sync; the metronome is a transient playback preference (persisted locally,
 * pushed to the scheduler), not part of the project/edit stream.
 */
import { useEffect } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import { useProject } from "../audio/project/useProject";
import { useRecorder } from "./useRecorder";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";

const COUNT_IN_OPTIONS = [
  { label: "No count-in", value: 0 },
  { label: "1 bar count-in", value: 1 },
  { label: "2 bar count-in", value: 2 },
];

export function TransportBar({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const [metronome, setMetronome] = usePersistentBoolean("web-daw:metronome", false);
  const [countInBars, setCountInBars] = usePersistentNumber("web-daw:count-in-bars", 1, 0, 2);

  // The scheduler reads this flag each tick; keep it in sync with the preference.
  useEffect(() => {
    scheduler.setMetronomeEnabled(metronome);
  }, [scheduler, metronome]);
  // The recorder reads the count-in length when a take starts.
  useEffect(() => {
    recorder.setCountInBars(countInBars);
  }, [recorder, countInBars]);

  const recording = rec.status === "recording" || rec.status === "counting";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={!started}
        // Stopping while recording finalizes the take (recorder.stop also stops the
        // transport), so Stop never leaves a recording dangling.
        onClick={() => (recording ? void recorder.stop() : isPlaying ? scheduler.stop() : scheduler.play())}
        className="font-mono text-[13px] min-w-18 px-3 py-1.5 rounded-lg text-you bg-you/15 border border-you/45 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPlaying ? "■ Stop" : "▶ Play"}
      </button>
      <label className="inline-flex items-center gap-2 font-mono text-xs text-muted">
        Tempo
        <input
          type="number"
          min={20}
          max={300}
          value={project.tempoBpm}
          onChange={(e) =>
            dispatch({ type: "setTempo", bpm: Number(e.target.value) })
          }
          className="w-14 font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-bright"
        />
        BPM
      </label>
      <button
        type="button"
        aria-label="Metronome"
        aria-pressed={metronome}
        title={metronome ? "Metronome on" : "Metronome off"}
        onClick={() => setMetronome(!metronome)}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border cursor-pointer ${
          metronome
            ? "text-you bg-you/15 border-you/45"
            : "text-muted bg-card border-line hover:text-ink"
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

      <span className="w-px h-5 bg-line shrink-0" />

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
            : "Record a take onto a new audio track"
        }
        onClick={() => recorder.toggle()}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          recording ? "text-claude bg-claude/15 border-claude/55" : "text-claude/80 bg-card border-line hover:border-claude/55"
        }`}
      >
        <span className={`w-3 h-3 rounded-full bg-current ${rec.status === "counting" ? "animate-pulse" : ""}`} />
      </button>

      <select
        value={countInBars}
        onChange={(e) => setCountInBars(Number(e.target.value))}
        title="Count-in before recording"
        className="font-mono text-[11px] px-1 py-0.5 rounded border border-line bg-card text-ink"
      >
        {COUNT_IN_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {rec.devices.length > 1 && (
        <select
          value={rec.deviceId ?? ""}
          onChange={(e) => recorder.setDevice(e.target.value || null)}
          title="Input device"
          className="max-w-32 font-mono text-[11px] px-1 py-0.5 rounded border border-line bg-card text-ink truncate"
        >
          <option value="">Default input</option>
          {rec.devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microphone"}
            </option>
          ))}
        </select>
      )}

      {rec.status === "error" && rec.error && (
        <span className="font-mono text-[10.5px] text-claude" role="alert">
          {rec.error}
        </span>
      )}
    </div>
  );
}
