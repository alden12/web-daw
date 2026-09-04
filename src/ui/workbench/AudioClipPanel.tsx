/**
 * The editing surface for an audio track's active clip: a beat-grid ruler carrying the
 * loop region over the waveform, with a playhead that sweeps the region in sync with
 * the transport. Dragging the waveform slides the audio *under* the fixed grid, so a
 * transient can be lined up with a bar line without moving the grid itself.
 *
 * Extracted from CenterWorkbench when the touch shell gave the editor its own tab
 * (MOBILE-1); the behaviour is unchanged.
 */
import { useEffect, useRef, useState } from "react";
import type { AudioTrack } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Dispatch } from "../../audio/commands/types";
import type { TimeSignature } from "../../audio/project/types";
import { beatsPerSecond } from "../../audio/timing";
import { beatsPerBar as beatsPerBarOf } from "../../audio/project/schema";
import { useAnimationFrame } from "../useAnimationFrame";
import { beginPointerDrag } from "../pointerDrag";
import { beatToX } from "../timeline/timeGrid";
import { Ruler } from "../timeline/Ruler";
import { Waveform } from "../Waveform";
import { Fader } from "../MixerControls";

export function AudioClipPanel({
  track,
  scheduler,
  tempoBpm,
  timeSignature,
  loopStart,
  loopLength,
  dispatch,
}: {
  track: AudioTrack;
  scheduler: Scheduler;
  tempoBpm: number;
  /** Project time signature, for the bar gridlines + ruler. */
  timeSignature: TimeSignature;
  /** Arrangement loop region (beats), for the launch-mode playhead window. */
  loopStart: number;
  loopLength: number;
  dispatch: Dispatch;
}) {
  const clip = track.clips.find((clip) => clip.id === track.activeClipId) ?? track.clips[0];
  const bps = beatsPerSecond(tempoBpm);
  const beatsPerBar = beatsPerBarOf(timeSignature);
  const dur = clip?.durationSec || 0;
  const durBeats = Math.max(0.001, dur * bps);
  const loopStartSec = clip?.loopStartSec ?? 0;
  const loopEndSec = clip?.loopEndSec ?? dur;
  // Grid slide: the audio's content offset, in beats. The beat grid stays fixed and
  // the waveform (with its loop region) pans under it, so a transient can be lined up
  // with a bar line. Positive = the audio sits later (a gap on the downbeat).
  const gridOffsetSec = clip?.gridOffsetSec ?? 0;
  const gridOffsetBeats = gridOffsetSec * bps;

  // Measure the preview width so the clip fills it: px-per-beat = width / clip-beats.
  const previewRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(0);
  const pxPerBeat = previewW > 0 ? previewW / durBeats : 0;
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const measure = () => setPreviewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Live ticker: sweep the loop region in sync with the transport. The clip can be
  // placed several times; we follow whichever placement currently holds the playhead
  // and map its phase into the region (so it loops with the audio).
  const clipId = clip?.id;
  const placements = track.placements;
  // A launched clip overrides the arrangement and loops over the transport region,
  // so its playback window is the loop region (mirrors the scheduler's synthetic
  // placement), not a `track.placements` entry.
  const launched = clipId !== undefined && track.launchedClipId === clipId;
  useAnimationFrame(() => {
    const el = playheadRef.current;
    if (!el) return;
    const regionBeats = Math.max(0.001, (loopEndSec - loopStartSec) * bps);
    // The loop window is fixed on the grid (the slide moves the audio under it, not
    // the window), so the playhead sweeps the window's grid position straight.
    const loopStartBeats = loopStartSec * bps;
    let x: number | null = null;
    if (clipId && scheduler.isPlaying && pxPerBeat > 0) {
      const pos = scheduler.getPositionBeats();
      const active = launched
        ? { startBeat: loopStart, length: loopLength }
        : placements.find(
            (placement) =>
              placement.clipId === clipId && pos >= placement.startBeat && pos < placement.startBeat + placement.length,
          );
      if (active) {
        let phase = (pos - active.startBeat) % regionBeats;
        if (phase < 0) phase += regionBeats;
        x = beatToX(loopStartBeats + phase, pxPerBeat);
      }
    }
    el.style.opacity = x === null ? "0" : "1";
    if (x !== null) el.style.transform = `translateX(${x}px)`;
  }, [scheduler, clipId, placements, pxPerBeat, loopStartSec, loopEndSec, bps, launched, loopStart, loopLength]);

  if (!clip) return <div className="flex-1 min-h-0 p-3 text-muted text-sm">No audio clip.</div>;

  const setClip = (patch: { gain?: number; loopStartSec?: number; loopEndSec?: number; gridOffsetSec?: number }) =>
    dispatch({
      type: "setAudioClip",
      trackId: track.id,
      clipId: clip.id,
      patch,
    });

  // Drag the waveform body horizontally to slide the audio under the fixed grid. Uses
  // the shared window-listener drag (like the lanes and roll), so the gesture is not
  // sensitive to pointer-capture / button-state quirks.
  const onSlideDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || pxPerBeat <= 0) return;
    const startX = e.clientX;
    const base = gridOffsetSec;
    beginPointerDrag((ev) => {
      const dxBeats = (ev.clientX - startX) / pxPerBeat;
      setClip({ gridOffsetSec: base + dxBeats / bps });
    });
  };

  return (
    <div className="flex-1 min-h-0 p-3">
      <div className="h-full flex flex-col rounded-lg border border-line bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2 border-b border-line">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Audio clip</span>
          <span className="font-mono text-[12.5px] text-strong truncate">{clip.name}</span>
          {dur > 0 && <span className="ml-auto font-mono text-[10.5px] text-faint">{dur.toFixed(2)}s</span>}
        </div>
        <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
          {/* Beat-grid ruler (drag the two handles to set the loop region) over the
              waveform; the area outside the loop is dimmed; the playhead sweeps the
              region during playback. */}
          <div ref={previewRef} className="relative flex-1 min-h-0 flex flex-col">
            {previewW > 0 && dur > 0 && (
              <Ruler
                viewBeats={durBeats}
                loopStart={loopStartSec * bps}
                loopEnd={loopEndSec * bps}
                pxPerBeat={pxPerBeat}
                timeSignature={timeSignature}
                onSetLoopStart={(b) => setClip({ loopStartSec: b / bps })}
                onSetLoopEnd={(b) => setClip({ loopEndSec: b / bps })}
              />
            )}
            <div
              onPointerDown={onSlideDown}
              onDoubleClick={() => setClip({ gridOffsetSec: 0 })}
              title="Drag to slide the audio under the grid (double-click to reset)"
              className="relative flex-1 min-h-0 rounded-b bg-ground border border-line border-t-0 overflow-hidden cursor-ew-resize touch-none"
            >
              {/* The waveform pans under the fixed grid; its left edge is buffer
                  time 0, shifted right by the slide. A canvas is a replaced element,
                  so it needs an explicit height (h-full) to fill the box - top/bottom
                  insets alone leave it at its intrinsic size. */}
              <Waveform
                fileId={clip.fileId}
                gain={clip.gain}
                className="absolute top-0 h-full pointer-events-none"
                style={{
                  left: beatToX(gridOffsetBeats, pxPerBeat),
                  width: previewW || "100%",
                }}
              />
              {/* Beat grid over the waveform (bar lines + beat lines), fixed to the
                  grid so you can align a transient by sliding the audio under it. */}
              {pxPerBeat > 0 && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: [
                      `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${
                        pxPerBeat * beatsPerBar
                      }px)`,
                      `repeating-linear-gradient(90deg, var(--color-line-soft) 0 1px, transparent 1px ${pxPerBeat}px)`,
                    ].join(", "),
                  }}
                />
              )}
              {pxPerBeat > 0 && loopStartSec > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-ground/65 pointer-events-none"
                  style={{ width: beatToX(loopStartSec * bps, pxPerBeat) }}
                />
              )}
              {pxPerBeat > 0 && loopEndSec < dur && (
                <div
                  className="absolute inset-y-0 right-0 bg-ground/65 pointer-events-none"
                  style={{ left: beatToX(loopEndSec * bps, pxPerBeat) }}
                />
              )}
              <div
                ref={playheadRef}
                className="absolute top-0 bottom-0 left-0 w-0.5 bg-you pointer-events-none opacity-0 z-10"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted">
              Offset
              <span className="ml-2 text-faint">
                {gridOffsetSec >= 0 ? "+" : "−"}
                {Math.abs(gridOffsetSec).toFixed(2)}s
              </span>
              {gridOffsetSec !== 0 && (
                <button
                  type="button"
                  onClick={() => setClip({ gridOffsetSec: 0 })}
                  title="Reset offset"
                  className="ml-2 text-faint hover:text-ink cursor-pointer"
                >
                  reset
                </button>
              )}
            </span>
            <label className="inline-flex items-center gap-2 font-mono text-[11px] text-muted ml-auto">
              Gain
              <Fader value={clip.gain} max={4} width={80} title="Clip gain" onChange={(v) => setClip({ gain: v })} />
              <span className="text-faint w-10">{clip.gain.toFixed(2)}×</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
