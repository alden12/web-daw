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
import type { McpStatus } from "../audio/mcp/bridge";
import type { WsStatus } from "../contract/client";
import { SyncChip } from "./ConnectionStatus";
import { useProject } from "../audio/project/useProject";
import { beatsPerSecond } from "../audio/timing";
import { useAnimationFrame } from "./useAnimationFrame";
import { useRecorder } from "./useRecorder";
import { savePatch, newPatchId } from "../audio/patches/library";
import { EMPTY_INSTRUMENT, pickableInstrumentInfos } from "../audio/instruments/catalog";
import { InstrumentPanel } from "./InstrumentPanel";
import { DrumkitPanel } from "./DrumkitPanel";
import { EffectChain, FlowArrow } from "./EffectChain";
import { MidiDeviceChain } from "./MidiDeviceChain";
import { StepGrid } from "./StepGrid";
import { Fader } from "./MixerControls";
import { PianoRoll } from "./PianoRoll";
import { DrumRoll } from "./DrumRoll";
import { ClipRail } from "./ClipRail";
import { Waveform } from "./Waveform";
import { Ruler } from "./timeline/Ruler";
import { beatToX } from "./timeline/timeGrid";
import { beatsPerBar as beatsPerBarOf } from "../audio/project/schema";
import { beginPointerDrag } from "./pointerDrag";
import { InlineRename } from "./InlineRename";
import { ResizeHandle } from "./ResizeHandle";
import { usePersistentNumber, usePersistentString } from "./usePersistent";
import type { SampleAsset } from "../audio/samples/catalog";

// The built-in agent does not need MCP, so a missing connection is not a warning:
// only "connected" is called out (green + label); otherwise it is a quiet grey dot
// you can hover for status.
const MCP_DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  connecting: "bg-faint",
  disconnected: "bg-faint",
};
const MCP_TITLE: Record<McpStatus, string> = {
  connected: "MCP connected",
  connecting: "MCP connecting…",
  disconnected: "MCP disconnected",
};

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
      midiDevices: track.midiDevices.map((device) => ({
        type: device.type,
        bypassed: device.bypassed,
        params: device.params.snapshot(),
      })),
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

/** Shown in the device rack for an empty track (no instrument yet): pick one to assign. */
function InstrumentPicker({ trackId, dispatch }: { trackId: string; dispatch: Dispatch }) {
  return (
    <div className="w-full p-1">
      <p className="text-[11.5px] text-muted mb-2">This track has no instrument yet. Choose one:</p>
      <div className="flex flex-wrap gap-1.5">
        {pickableInstrumentInfos().map((info) => (
          <button
            key={info.type}
            type="button"
            onClick={() => dispatch({ type: "setInstrument", trackId, instrumentType: info.type })}
            className="px-2.5 py-1 rounded-md border border-line text-[12px] text-ink hover:text-bright hover:border-you cursor-pointer"
          >
            {info.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AudioClipPanel({
  track,
  scheduler,
  tempoBpm,
  beatsPerBar,
  loopStart,
  loopLength,
  dispatch,
}: {
  track: AudioTrack;
  scheduler: Scheduler;
  tempoBpm: number;
  /** Bar length in beats (from the project time signature), for the bar gridlines. */
  beatsPerBar: number;
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

/** The two editor surfaces a drum-kit track offers over its one note clip. */
type DrumEditor = "pads" | "keys";
const DRUM_EDITORS: readonly DrumEditor[] = ["keys", "pads"];
const DRUM_EDITOR_LABEL: Record<DrumEditor, string> = { pads: "Pads", keys: "Keys" };

/** A little Pads | Keys segmented toggle: pick the step grid or the piano roll. */
function DrumEditorToggle({ mode, onChange }: { mode: DrumEditor; onChange: (mode: DrumEditor) => void }) {
  return (
    <div className="ml-auto inline-flex items-center rounded-md border border-line overflow-hidden" role="group">
      {DRUM_EDITORS.map((editor) => (
        <button
          key={editor}
          type="button"
          aria-pressed={mode === editor}
          onClick={() => onChange(editor)}
          className={`font-mono text-[10.5px] px-2 py-0.5 cursor-pointer ${
            mode === editor ? "bg-you/20 text-you" : "text-muted hover:text-ink"
          }`}
        >
          {DRUM_EDITOR_LABEL[editor]}
        </button>
      ))}
    </div>
  );
}

/**
 * The note editor for an instrument track: the clip header (name + drum-mode toggle)
 * over the editing surface. A drum-kit track can be edited as a pad x step grid
 * ("Pads") or the drum-labelled piano roll ("Keys"), remembered per track; every
 * other instrument is the plain piano roll. All three drive the same note clip.
 */
function InstrumentEditor({
  track,
  samples,
  scheduler,
  recorder,
  dispatch,
  projectStore,
}: {
  track: InstrumentTrack;
  samples: SampleAsset[];
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  projectStore: ProjectStore;
}) {
  const isDrumkit = track.instrumentType === "drumkit";
  const [mode, setMode] = usePersistentString<DrumEditor>(`web-daw:drum-editor:${track.id}`, "keys", DRUM_EDITORS);
  const active = track.clips.find((clip) => clip.id === track.activeClipId) ?? track.clips[0];

  return (
    <div className="flex-1 min-w-0 min-h-0 p-3 flex flex-col gap-2">
      <div className="shrink-0 flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
          clip
          <InlineRename
            value={active.name}
            onCommit={(name) => dispatch({ type: "renameClip", trackId: track.id, clipId: active.id, name })}
            className="text-[12px] text-bright"
          />
        </div>
        {isDrumkit && <DrumEditorToggle mode={mode} onChange={setMode} />}
      </div>
      {/* Key by the active clip so the surface remounts (re-fits, resets selection) on switch. */}
      <div className="flex-1 min-h-0">
        {isDrumkit && mode === "pads" ? (
          <StepGrid
            key={active.id}
            clipStore={active.store}
            params={track.params}
            trackId={track.id}
            clipId={active.id}
            samples={samples}
            scheduler={scheduler}
            dispatch={dispatch}
          />
        ) : isDrumkit ? (
          <DrumRoll
            key={active.id}
            clipStore={active.store}
            params={track.params}
            trackId={track.id}
            clipId={active.id}
            samples={samples}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            projectStore={projectStore}
          />
        ) : (
          <PianoRoll
            key={active.id}
            clipStore={active.store}
            scheduler={scheduler}
            recorder={recorder}
            trackId={track.id}
            clipId={active.id}
            dispatch={dispatch}
            projectStore={projectStore}
          />
        )}
      </div>
    </div>
  );
}

export function CenterWorkbench({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  selectedTrack,
  onRevealSamples,
  mcpStatus,
  syncStatus,
  agentCollapsed,
  onExpandAgent,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  selectedTrack: Track | undefined;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
  /** MCP connection status - shown as a dot in the tab bar's indicator area. */
  mcpStatus: McpStatus;
  /** Sync-server connection status - shown as a chip beside MCP. `null` in local (no-sync) mode. */
  syncStatus: WsStatus | null;
  /** The agent pane is collapsed away; the tab bar hosts its expand control. */
  agentCollapsed: boolean;
  onExpandAgent: () => void;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const recording = rec.status === "recording" || rec.status === "counting";
  // The instrument+effects rack is a resizable, wrapping panel above the roll.
  const [deviceH, setDeviceH] = usePersistentNumber("web-daw:devices-height", 200, 80, 620);
  const deviceRef = useRef<HTMLDivElement>(null);
  // The clip rail beside the piano roll is drag-resizable too (its own width).
  const [clipRailW, setClipRailW] = usePersistentNumber("web-daw:clip-rail-width", 96, 72, 260);
  const clipRailRef = useRef<HTMLDivElement>(null);

  // The tab bar's right-hand indicator area: the MCP status dot, then (when the
  // agent pane is collapsed away) its expand control - there is no idle rail.
  const indicators = (
    <div className="ml-auto self-center flex items-center gap-2 pr-2">
      {syncStatus && <SyncChip status={syncStatus} />}
      {/* MCP is a dev/local bridge; show it only when actually connected, so it doesn't sit as a
          second bare dot beside the sync chip (confusing) the rest of the time. */}
      {mcpStatus === "connected" && (
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted"
          title={MCP_TITLE[mcpStatus]}
        >
          <span className={`w-2 h-2 rounded-full ${MCP_DOT[mcpStatus]}`} />
          MCP
        </span>
      )}
      {agentCollapsed && (
        <button
          type="button"
          onClick={onExpandAgent}
          aria-label="Expand agent panel"
          title="Open the agent panel"
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted hover:text-bright hover:bg-panel cursor-pointer"
        >
          <span className="text-lg leading-none">«</span>
        </button>
      )}
    </div>
  );

  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="flex items-center h-11 border-b border-line shrink-0">{indicators}</div>
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument or import audio from the library.
        </div>
      </div>
    );
  }

  const kindLabel =
    selectedTrack.kind === "audio"
      ? "audio"
      : selectedTrack.instrumentType === EMPTY_INSTRUMENT
        ? "empty"
        : selectedTrack.instrumentType;

  return (
    <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* The selected track is a single editor tab (reserving space for future
          multi-window tabs); it carries the track name + kind chip. The agent-expand
          control sits at the far right of the tab bar. */}
      <div className="flex items-stretch h-11 border-b border-line shrink-0" role="tablist" aria-label="Open editors">
        <div className="relative flex items-center gap-2 h-full pl-3.5 pr-4 border-r border-line bg-card/50 max-w-72">
          <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-you" />
          <span className="w-2 h-2 rounded-full bg-you shrink-0" />
          <InlineRename
            value={selectedTrack.name}
            onCommit={(name) => dispatch({ type: "setTrack", trackId: selectedTrack.id, name })}
            className="font-semibold text-sm text-bright"
          />
          <span className="font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">{kindLabel}</span>
        </div>
        {indicators}
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
          <InstrumentEditor
            key={selectedTrack.id}
            track={selectedTrack}
            samples={project.samples}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            projectStore={projectStore}
          />
        ) : (
          <AudioClipPanel
            track={selectedTrack}
            scheduler={scheduler}
            tempoBpm={project.tempoBpm}
            beatsPerBar={beatsPerBarOf(project.timeSignature)}
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
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line shrink-0">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Devices</span>
          {selectedTrack.kind === "instrument" && selectedTrack.instrumentType !== EMPTY_INSTRUMENT && (
            <span className="ml-auto">
              <SavePatchControl track={selectedTrack} />
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-wrap items-stretch gap-x-1 gap-y-3 p-3">
            {/* MIDI devices transform notes before the instrument, so they lead the chain. */}
            <MidiDeviceChain projectStore={projectStore} trackId={selectedTrack.id} dispatch={dispatch} />
            {selectedTrack.kind === "instrument" &&
              (selectedTrack.instrumentType === EMPTY_INSTRUMENT ? (
                <InstrumentPicker trackId={selectedTrack.id} dispatch={dispatch} />
              ) : (
                // The instrument is the first device; its trailing arrow (into the first
                // effect) stays glued to its right edge, so it wraps cleanly. A drum kit
                // uses its own pad panel in place of the generic knob panel.
                <div className="flex items-stretch shrink-0">
                  {selectedTrack.instrumentType === "drumkit" ? (
                    <DrumkitPanel
                      params={selectedTrack.params}
                      trackId={selectedTrack.id}
                      dispatch={dispatch}
                      samples={project.samples}
                      onRevealSamples={onRevealSamples}
                      projectStore={projectStore}
                    />
                  ) : (
                    <InstrumentPanel
                      params={selectedTrack.params}
                      instrumentType={selectedTrack.instrumentType}
                      trackId={selectedTrack.id}
                      dispatch={dispatch}
                      samples={project.samples}
                      onRevealSamples={onRevealSamples}
                      projectStore={projectStore}
                    />
                  )}
                  {selectedTrack.effects.length > 0 ? <FlowArrow /> : null}
                </div>
              ))}
            <EffectChain projectStore={projectStore} trackId={selectedTrack.id} dispatch={dispatch} />
          </div>
        </div>
      </div>
    </div>
  );
}
