/**
 * The center workbench: everything about the selected track in one focused
 * surface. For an instrument track, the instrument + effect chain form a compact
 * horizontally-scrolling signal strip up top and the clip's MIDI fills the rest.
 * For an audio track, an audio-clip panel takes the place of the instrument +
 * piano roll; the effect chain is shared (audio tracks have inserts too).
 */
import { useEffect, useRef, useState } from "react";
import type { ProjectStore, Track, AudioTrack, InstrumentTrack } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import { useProject } from "../audio/project/useProject";
import { beatsPerSecond } from "../audio/timing";
import { useAnimationFrame } from "./useAnimationFrame";
import { useRecorder } from "./useRecorder";
import { savePatch, newPatchId } from "../audio/patches/library";
import { InstrumentPanel } from "./InstrumentPanel";
import { EffectChain } from "./EffectChain";
import { Fader } from "./MixerControls";
import { PianoRoll } from "./PianoRoll";
import { ClipRail } from "./ClipRail";
import { Waveform } from "./Waveform";
import { Ruler } from "./timeline/Ruler";
import { beatToX } from "./timeline/timeGrid";
import { InlineRename } from "./InlineRename";
import { ResizeHandle } from "./ResizeHandle";
import { usePersistentNumber } from "./usePersistent";

/**
 * "Save as patch": capture the instrument + its params + effect chain as a named,
 * reusable library entry. Clicking reveals an inline name field (defaulting to the
 * track name); Enter or Save writes it to the global patch library.
 */
function SavePatchControl({ track }: { track: InstrumentTrack }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    savePatch({
      id: newPatchId(),
      name: name.trim() || track.name,
      author: "you",
      instrumentType: track.instrumentType,
      params: track.params.snapshot(),
      effects: track.effects.map((fx) => ({
        type: fx.type,
        bypassed: fx.bypassed,
        params: fx.params.snapshot(),
      })),
      createdAt: Date.now(),
    });
    setNaming(false);
    setName("");
  };

  if (!naming)
    return (
      <button
        type="button"
        title="Save this instrument + effects as a reusable patch"
        onClick={() => {
          setName(track.name);
          setNaming(true);
        }}
        className="font-mono text-[10.5px] px-2 py-0.5 rounded border border-line text-muted hover:text-ink hover:border-you cursor-pointer"
      >
        Save as patch
      </button>
    );

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setNaming(false);
        }}
        placeholder="Patch name…"
        className="w-32 font-mono text-[11px] px-1.5 py-0.5 rounded border border-line bg-ground text-bright placeholder:text-faint"
      />
      <button
        type="button"
        onClick={save}
        className="font-mono text-[10.5px] px-2 py-0.5 rounded border border-you/45 bg-you/15 text-you cursor-pointer"
      >
        Save
      </button>
    </span>
  );
}

function AudioClipPanel({
  track,
  scheduler,
  tempoBpm,
  loopStart,
  loopLength,
  dispatch,
}: {
  track: AudioTrack;
  scheduler: Scheduler;
  tempoBpm: number;
  /** Arrangement loop region (beats), for the launch-mode playhead window. */
  loopStart: number;
  loopLength: number;
  dispatch: Dispatch;
}) {
  const clip = track.clips.find((clip) => clip.id === track.activeClipId) ?? track.clips[0];
  const bps = beatsPerSecond(tempoBpm);
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
  const slideRef = useRef<{ x: number; base: number } | null>(null);
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

  // Drag the waveform body horizontally to slide the audio under the fixed grid.
  const onSlideDown = (e: React.PointerEvent) => {
    if (pxPerBeat <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    slideRef.current = { x: e.clientX, base: gridOffsetSec };
  };
  const onSlideMove = (e: React.PointerEvent) => {
    const d = slideRef.current;
    if (!d || !e.buttons || pxPerBeat <= 0) return;
    const dxBeats = (e.clientX - d.x) / pxPerBeat;
    setClip({ gridOffsetSec: d.base + dxBeats / bps });
  };
  const endSlide = () => {
    slideRef.current = null;
  };

  return (
    <div className="flex-1 min-h-0 p-3">
      <div className="h-full flex flex-col rounded-lg border border-line bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2 border-b border-line">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Audio clip</span>
          <span className="font-mono text-[12.5px] text-bright truncate">{clip.name}</span>
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
                onSetLoopStart={(b) => setClip({ loopStartSec: b / bps })}
                onSetLoopEnd={(b) => setClip({ loopEndSec: b / bps })}
              />
            )}
            <div
              onPointerDown={onSlideDown}
              onPointerMove={onSlideMove}
              onPointerUp={endSlide}
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

/** Record a new take into this track (arms it first); stops if recording. Audio
 *  tracks capture the mic; instrument tracks capture live MIDI notes. */
function TrackRecordButton({
  trackId,
  recorder,
  recording,
}: {
  trackId: string;
  recorder: Recorder;
  recording: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => recorder.recordInto(trackId)}
      title={recording ? "Stop recording" : "Record a new take into this track"}
      className={`w-full inline-flex items-center justify-center gap-1.5 font-mono text-[11px] px-2 py-1 rounded-md border cursor-pointer ${
        recording ? "text-claude bg-claude/15 border-claude/55" : "text-claude/85 border-claude/40 hover:bg-claude/10"
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full bg-current ${recording ? "animate-pulse" : ""}`} />
      {recording ? "Stop" : "Rec"}
    </button>
  );
}

export function CenterWorkbench({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  selectedTrack,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  selectedTrack: Track | undefined;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const recording = rec.status === "recording" || rec.status === "counting";
  // The instrument+effects rack is a resizable, wrapping panel above the roll.
  const [deviceH, setDeviceH] = usePersistentNumber("web-daw:devices-height", 168, 80, 620);
  const deviceRef = useRef<HTMLDivElement>(null);
  // The clip rail beside the piano roll is drag-resizable too (its own width).
  const [clipRailW, setClipRailW] = usePersistentNumber("web-daw:clip-rail-width", 96, 72, 260);
  const clipRailRef = useRef<HTMLDivElement>(null);

  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument or import audio from the library.
        </div>
      </div>
    );
  }

  const kindLabel = selectedTrack.kind === "audio" ? "audio" : selectedTrack.instrumentType;
  const activeClip =
    selectedTrack.clips.find((clip) => clip.id === selectedTrack.activeClipId) ?? selectedTrack.clips[0];

  return (
    <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-center gap-2.5 h-12 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-you" />
        <InlineRename
          value={selectedTrack.name}
          onCommit={(name) => dispatch({ type: "setTrack", trackId: selectedTrack.id, name })}
          className="font-semibold text-sm text-bright"
        />
        <span className="font-mono text-[10.5px] text-faint">{kindLabel}</span>
        {selectedTrack.kind === "instrument" && <SavePatchControl track={selectedTrack} />}
        {activeClip && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
            clip
            <InlineRename
              value={activeClip.name}
              onCommit={(name) =>
                dispatch({
                  type: "renameClip",
                  trackId: selectedTrack.id,
                  clipId: activeClip.id,
                  name,
                })
              }
              className="text-[12px] text-bright"
            />
          </span>
        )}
      </div>

      {/* Top-to-bottom signal flow: notes (piano roll) / audio clip on top, then the
          instrument + effect rack below, then the arrangement output (bottom panel).
          Both kinds share the resizable clip rail on the left; the right is the piano
          roll (instrument) or the audio-clip panel (audio). The rail's footer is a
          record button that records a take into this track (mic / live MIDI). */}
      <div className="flex-1 min-h-0 flex" key={`${selectedTrack.id}:body`}>
        <div ref={clipRailRef} className="relative shrink-0 flex" style={{ width: clipRailW }}>
          <ClipRail
            projectStore={projectStore}
            scheduler={scheduler}
            trackId={selectedTrack.id}
            dispatch={dispatch}
            orientation="vertical"
            footer={<TrackRecordButton trackId={selectedTrack.id} recorder={recorder} recording={recording} />}
          />
          <ResizeHandle
            ariaLabel="Resize clips"
            onResize={(x) => setClipRailW(x - (clipRailRef.current?.getBoundingClientRect().left ?? 0))}
            style={{ right: 0, top: 0, bottom: 0 }}
          />
        </div>
        {selectedTrack.kind === "instrument" ? (
          <div className="flex-1 min-w-0 min-h-0 p-3">
            {(() => {
              const active =
                selectedTrack.clips.find((clip) => clip.id === selectedTrack.activeClipId) ?? selectedTrack.clips[0];
              // Key by the active clip so the roll remounts (re-fits, resets selection) on switch.
              return (
                <PianoRoll
                  key={active.id}
                  clipStore={active.store}
                  scheduler={scheduler}
                  recorder={recorder}
                  trackId={selectedTrack.id}
                  dispatch={dispatch}
                />
              );
            })()}
          </div>
        ) : (
          <AudioClipPanel
            track={selectedTrack}
            scheduler={scheduler}
            tempoBpm={project.tempoBpm}
            loopStart={project.loopStart}
            loopLength={project.lengthBeats - project.loopStart}
            dispatch={dispatch}
          />
        )}
      </div>

      {/* device rack: instrument + effects, below the notes (resizable height, drag
          its top edge), so the flow reads notes -> instrument -> effects -> output. */}
      <div
        ref={deviceRef}
        className="relative shrink-0 flex flex-col border-t border-line"
        style={{ height: deviceH }}
        key={`${selectedTrack.id}:dev`}
      >
        <ResizeHandle
          ariaLabel="Resize devices"
          orientation="horizontal"
          onResize={(y) => setDeviceH((deviceRef.current?.getBoundingClientRect().bottom ?? 0) - y)}
          style={{ left: 0, right: 0, top: 0 }}
        />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-wrap items-stretch gap-x-1 gap-y-3 p-3">
            {selectedTrack.kind === "instrument" && (
              <InstrumentPanel
                params={selectedTrack.params}
                instrumentType={selectedTrack.instrumentType}
                trackId={selectedTrack.id}
                dispatch={dispatch}
                samples={project.samples}
              />
            )}
            <EffectChain
              projectStore={projectStore}
              trackId={selectedTrack.id}
              showFirstArrow={selectedTrack.kind === "instrument"}
              dispatch={dispatch}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
