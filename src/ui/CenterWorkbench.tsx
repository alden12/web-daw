/**
 * The center workbench: everything about the selected track in one focused
 * surface. For an instrument track, the instrument + effect chain form a compact
 * horizontally-scrolling signal strip up top and the clip's MIDI fills the rest.
 * For an audio track, an audio-clip panel takes the place of the instrument +
 * piano roll; the effect chain is shared (audio tracks have inserts too).
 */
import { useEffect, useRef, useState } from "react";
import type {
  ProjectStore,
  Track,
  AudioTrack,
  InstrumentTrack,
} from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import { useProject } from "../audio/project/useProject";
import { useRecorder } from "./useRecorder";
import { savePatch, newPatchId } from "../audio/patches/library";
import { InstrumentPanel } from "./InstrumentPanel";
import { EffectChain } from "./EffectChain";
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
  tempoBpm,
  dispatch,
}: {
  track: AudioTrack;
  tempoBpm: number;
  dispatch: Dispatch;
}) {
  const clip =
    track.clips.find((c) => c.id === track.activeClipId) ?? track.clips[0];
  // Measure the preview width so the clip fills it: px-per-beat = width / clip-beats.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(0);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const measure = () => setPreviewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!clip)
    return (
      <div className="flex-1 min-h-0 p-3 text-muted text-sm">
        No audio clip.
      </div>
    );

  const bps = tempoBpm / 60;
  const dur = clip.durationSec || 0;
  const durBeats = Math.max(0.001, dur * bps);
  const pxPerBeat = previewW > 0 ? previewW / durBeats : 0;
  const loopStartSec = clip.loopStartSec ?? 0;
  const loopEndSec = clip.loopEndSec ?? dur;
  const setClip = (patch: { gain?: number; loopStartSec?: number; loopEndSec?: number }) =>
    dispatch({ type: "setAudioClip", trackId: track.id, clipId: clip.id, patch });

  return (
    <div className="flex-1 min-h-0 p-3">
      <div className="h-full flex flex-col rounded-lg border border-line bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2 border-b border-line">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">
            Audio clip
          </span>
          <span className="font-mono text-[12.5px] text-bright truncate">
            {clip.name}
          </span>
          {dur > 0 && (
            <span className="ml-auto font-mono text-[10.5px] text-faint">
              {dur.toFixed(2)}s
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
          {/* Beat-grid ruler (drag the two handles to set the loop region) over the
              waveform; the area outside the loop is dimmed. */}
          <div ref={previewRef} className="relative">
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
            <div className="relative h-20 rounded-b bg-ground border border-line border-t-0 overflow-hidden">
              <div className="absolute inset-y-0 left-0 right-0 bg-you/15" />
              <Waveform fileId={clip.fileId} className="absolute inset-0 w-full h-full" />
              {pxPerBeat > 0 && loopStartSec > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-ground/65"
                  style={{ width: beatToX(loopStartSec * bps, pxPerBeat) }}
                />
              )}
              {pxPerBeat > 0 && loopEndSec < dur && (
                <div
                  className="absolute inset-y-0 right-0 bg-ground/65"
                  style={{ left: beatToX(loopEndSec * bps, pxPerBeat) }}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] text-faint">
              Drag the ruler handles to set the loop region.
            </span>
            <label className="inline-flex items-center gap-2 font-mono text-[11px] text-muted ml-auto">
              Gain
              <input
                type="range"
                min={0}
                max={4}
                step={0.01}
                value={clip.gain}
                onChange={(e) => setClip({ gain: Number(e.target.value) })}
                className="w-28"
              />
              <span className="text-faint w-10">{clip.gain.toFixed(2)}×</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Record a new take into this audio track (arms it first); stops if recording. */
function AudioRecordButton({
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
        recording
          ? "text-claude bg-claude/15 border-claude/55"
          : "text-claude/85 border-claude/40 hover:bg-claude/10"
      }`}
    >
      <span
        className={`w-2.5 h-2.5 rounded-full bg-current ${recording ? "animate-pulse" : ""}`}
      />
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
  const [deviceH, setDeviceH] = usePersistentNumber(
    "web-daw:devices-height",
    168,
    80,
    620,
  );
  const deviceRef = useRef<HTMLDivElement>(null);
  // The clip rail beside the piano roll is drag-resizable too (its own width).
  const [clipRailW, setClipRailW] = usePersistentNumber(
    "web-daw:clip-rail-width",
    96,
    72,
    260,
  );
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

  const kindLabel =
    selectedTrack.kind === "audio" ? "audio" : selectedTrack.instrumentType;
  const activeClip =
    selectedTrack.clips.find((c) => c.id === selectedTrack.activeClipId) ??
    selectedTrack.clips[0];

  return (
    <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-center gap-2.5 h-12 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-you" />
        <InlineRename
          value={selectedTrack.name}
          onCommit={(name) =>
            dispatch({ type: "setTrack", trackId: selectedTrack.id, name })
          }
          className="font-semibold text-sm text-bright"
        />
        <span className="font-mono text-[10.5px] text-faint">{kindLabel}</span>
        {selectedTrack.kind === "instrument" && (
          <SavePatchControl track={selectedTrack} />
        )}
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
          roll (instrument) or the audio-clip panel (audio). For audio, the rail's
          footer is a record button that records a take into this track. */}
      <div className="flex-1 min-h-0 flex" key={`${selectedTrack.id}:body`}>
        <div
          ref={clipRailRef}
          className="relative shrink-0 flex"
          style={{ width: clipRailW }}
        >
          <ClipRail
            projectStore={projectStore}
            scheduler={scheduler}
            trackId={selectedTrack.id}
            dispatch={dispatch}
            orientation="vertical"
            footer={
              selectedTrack.kind === "audio" ? (
                <AudioRecordButton
                  trackId={selectedTrack.id}
                  recorder={recorder}
                  recording={recording}
                />
              ) : undefined
            }
          />
          <ResizeHandle
            ariaLabel="Resize clips"
            onResize={(x) =>
              setClipRailW(
                x - (clipRailRef.current?.getBoundingClientRect().left ?? 0),
              )
            }
            style={{ right: 0, top: 0, bottom: 0 }}
          />
        </div>
        {selectedTrack.kind === "instrument" ? (
          <div className="flex-1 min-w-0 min-h-0 p-3">
            {(() => {
              const active =
                selectedTrack.clips.find(
                  (c) => c.id === selectedTrack.activeClipId,
                ) ?? selectedTrack.clips[0];
              // Key by the active clip so the roll remounts (re-fits, resets selection) on switch.
              return (
                <PianoRoll
                  key={active.id}
                  clipStore={active.store}
                  scheduler={scheduler}
                  trackId={selectedTrack.id}
                  dispatch={dispatch}
                />
              );
            })()}
          </div>
        ) : (
          <AudioClipPanel track={selectedTrack} tempoBpm={project.tempoBpm} dispatch={dispatch} />
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
          onResize={(y) =>
            setDeviceH(
              (deviceRef.current?.getBoundingClientRect().bottom ?? 0) - y,
            )
          }
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
              />
            )}
            <EffectChain
              projectStore={projectStore}
              trackId={selectedTrack.id}
              dispatch={dispatch}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
