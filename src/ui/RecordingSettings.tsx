/**
 * Recording settings section: audio input/output devices, the manual recording-latency
 * trim, and a tap-to-calibrate helper. One tab of SettingsPanel.tsx.
 *
 * A mic take lands late by the input+output round-trip; the recorder shifts it back by an
 * automatic estimate that can't include the interface's input latency, so the trim closes
 * the gap. "Calibrate" measures that gap for you: it plays a click train and records you
 * tapping the mic on each click, then sets the trim to the median gap (an acoustic loopback).
 * The trim persists (read by the recorder at capture time); the device choices persist too.
 */
import { useEffect, useState } from "react";
import type { AudioEngine } from "../audio/engine/AudioEngine";
import type { Recorder } from "../audio/recording/recorder";
import { runMicCalibration } from "../audio/recording/calibration";
import { useRecorder } from "./useRecorder";
import { usePersistentNumber, usePersistentString } from "./usePersistent";
import { RECORD_OFFSET_KEY, RECORD_OFFSET_RANGE } from "./recordOffset";
import { OUTPUT_DEVICE_KEY } from "./outputDevice";

type CalState =
  | { phase: "idle" }
  | { phase: "running"; stage: "count-in" | "measure"; beat: number; beats: number }
  | { phase: "done"; offsetMs: number; matched: number; spreadMs: number }
  | { phase: "error" };

const SELECT_CLASS =
  "flex-1 min-w-0 bg-ground border border-line rounded px-2 py-1 text-[12.5px] text-ink cursor-pointer";

export function RecordingSettings({ recorder, engine }: { recorder: Recorder; engine: AudioEngine }) {
  const rec = useRecorder(recorder);
  const [offsetMs, setOffsetMs] = usePersistentNumber(
    RECORD_OFFSET_KEY,
    0,
    RECORD_OFFSET_RANGE.min,
    RECORD_OFFSET_RANGE.max,
  );
  const [outputId, setOutputId] = usePersistentString<string>(OUTPUT_DEVICE_KEY, "");
  const [outputs, setOutputs] = useState<{ deviceId: string; label: string }[]>([]);
  const [cal, setCal] = useState<CalState>({ phase: "idle" });

  // Populate device lists when the tab opens (labels fill in once permission is granted).
  useEffect(() => {
    void recorder.refreshDevices();
    if (engine.canSelectOutput) void engine.listOutputDevices().then(setOutputs);
  }, [recorder, engine]);

  const pickOutput = (deviceId: string) => {
    setOutputId(deviceId);
    void engine.setOutputDevice(deviceId || null);
  };

  const runCalibration = async () => {
    if (!engine.started) return;
    setCal({ phase: "running", stage: "count-in", beat: 0, beats: 4 });
    try {
      const result = await runMicCalibration(engine, {
        deviceId: rec.deviceId ?? undefined,
        onBeat: (index, total, stage) => setCal({ phase: "running", stage, beat: index + 1, beats: total }),
      });
      // A confident result needs a few matched taps; otherwise ask for a retry.
      if (result && result.matched >= 3)
        setCal({ phase: "done", offsetMs: result.offsetMs, matched: result.matched, spreadMs: result.spreadMs });
      else setCal({ phase: "error" });
    } catch {
      setCal({ phase: "error" });
    }
  };

  const applyCalibration = () => {
    if (cal.phase === "done") setOffsetMs(cal.offsetMs);
    setCal({ phase: "idle" });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Devices */}
      <div className="flex flex-col gap-2.5">
        <span className="text-[11px] uppercase tracking-wide text-faint">Audio devices</span>
        <label className="flex items-center gap-2">
          <span className="w-14 text-[12px] text-muted">Input</span>
          <select
            aria-label="Input device"
            value={rec.deviceId ?? ""}
            onChange={(event) => recorder.setDevice(event.target.value || null)}
            className={SELECT_CLASS}
          >
            <option value="">Default input</option>
            {rec.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
        {engine.canSelectOutput ? (
          <label className="flex items-center gap-2">
            <span className="w-14 text-[12px] text-muted">Output</span>
            <select
              aria-label="Output device"
              value={outputId}
              onChange={(event) => pickOutput(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Default output</option>
              {outputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Output"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-[11px] text-faint">
            Output-device selection needs Chrome or Edge; using the system default.
          </p>
        )}
        <p className="text-[11px] text-faint leading-relaxed">
          Device names appear after you grant microphone access (record a take or calibrate once).
        </p>
      </div>

      {/* Recording latency */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="record-offset" className="text-[12.5px] text-ink">
            Recording latency
          </label>
          <span className="ml-auto font-mono text-[12px] text-bright tabular-nums">{offsetMs} ms</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            id="record-offset"
            type="range"
            min={RECORD_OFFSET_RANGE.min}
            max={RECORD_OFFSET_RANGE.max}
            step={1}
            value={offsetMs}
            onChange={(event) => setOffsetMs(Number(event.target.value))}
            aria-label="Recording latency (ms)"
            className="flex-1 accent-you cursor-pointer"
          />
          <button
            type="button"
            onClick={() => setOffsetMs(0)}
            className="text-[11px] text-faint hover:text-ink cursor-pointer"
          >
            reset
          </button>
        </div>
        <p className="text-[11px] text-faint leading-relaxed">
          How much earlier to place a recorded take, on top of the automatic estimate. Raise it if your mic takes land
          late relative to the beat.
        </p>
      </div>

      {/* Tap-to-calibrate */}
      <div className="flex flex-col gap-2">
        {cal.phase === "running" ? (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-claude animate-pulse" />
            <span className="text-[12.5px] text-ink">
              {cal.stage === "count-in" ? "Tap along to lock the tempo…" : "Keep tapping - now measuring…"}
            </span>
            <span className="ml-auto font-mono text-[12px] text-faint tabular-nums">
              {cal.stage === "count-in" ? `count-in ${cal.beat}/${cal.beats}` : `${cal.beat}/${cal.beats}`}
            </span>
          </div>
        ) : cal.phase === "done" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] text-ink">
              Measured <span className="font-mono text-bright">{cal.offsetMs} ms</span>{" "}
              <span className="text-faint">
                ({cal.matched} taps, ±{cal.spreadMs} ms
                {cal.spreadMs > 20 ? " - a bit shaky, redo for a tighter read" : ""})
              </span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={applyCalibration}
                className="px-2.5 py-1 rounded-md text-[12px] cursor-pointer bg-you/15 border border-you text-bright"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => void runCalibration()}
                className="text-[11px] text-faint hover:text-ink cursor-pointer"
              >
                redo
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runCalibration()}
              disabled={!engine.started}
              className="px-3 py-1.5 rounded-md text-[12px] border border-line text-ink hover:border-muted cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Calibrate by tapping
            </button>
            {cal.phase === "error" && (
              <span className="text-[11px] text-claude">Didn't catch enough taps - try again.</span>
            )}
            {!engine.started && <span className="text-[11px] text-faint">Start audio first.</span>}
          </div>
        )}
        <p className="text-[11px] text-faint leading-relaxed">
          Plays a short count-in then a run of clicks; tap the mic on every one. Sets the latency to the median gap
          (ignoring the count-in taps); the ± shows how consistent your taps were. Saved only in this browser.
        </p>
      </div>
    </div>
  );
}
