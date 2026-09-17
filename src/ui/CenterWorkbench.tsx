/**
 * The center workbench: everything about the selected track in one focused surface,
 * reading top to bottom as the signal path - notes (or the audio clip) up top, the
 * instrument + effect rack below, then the arrangement output.
 *
 * This is the *desktop* composition of three pieces that the touch shell splits across
 * tabs instead (MOBILE-1): the clip rail, the editor (`workbench/TrackEditor`) and the
 * device chain (`workbench/DeviceRack`). Only the arrangement lives here; each piece
 * owns its own behaviour.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ProjectStore, Track } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import type { McpStatus } from "../audio/mcp/bridge";
import type { WsStatus } from "../contract/client";
import { SyncChip } from "./ConnectionStatus";
import { useProject } from "../audio/project/useProject";
import { useRecorder } from "./useRecorder";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { ClipRail } from "./ClipRail";
import { InlineRename } from "./InlineRename";
import { ResizeHandle } from "./ResizeHandle";
import { usePersistentNumber } from "./usePersistent";
import { TrackEditor } from "./workbench/TrackEditor";
import { DeviceRack } from "./workbench/DeviceRack";
import { TrackRecordButton } from "./workbench/TrackRecordButton";

/**
 * Pixels of editor (roll / audio clip) the device rack may never take, however tall it
 * is persisted. Sized for the editor's own chrome (clip label + roll toolbar, ~90px)
 * plus a usable strip of grid underneath.
 *
 * This and `RACK_SHARE_WHEN_TIGHT` guard the **desktop**, despite having been found on a
 * phone (MOBILE-1, where a rack height saved on a big window left a ~30px roll). The
 * touch shell no longer stacks the two - the rack has its own tab - but here they still
 * share one vertical box, and `deviceH` is a persisted absolute while the body's height
 * moves with the window. Drag the rack tall, then shrink the window or reopen on a
 * smaller screen, and the squeeze is identical. Not mobile leftovers; do not delete.
 */
const MIN_EDITOR = 200;
/**
 * When the body is too short to give both their minimum, neither can win outright, so
 * the rack falls back to a fixed share and they are both merely cramped.
 */
const RACK_SHARE_WHEN_TIGHT = 0.35;

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
  // The instrument+effects rack is a resizable panel below the editor.
  const [deviceH, setDeviceH] = usePersistentNumber("web-daw:devices-height", 200, 80, 620);
  const deviceRef = useRef<HTMLDivElement>(null);
  // The clip rail beside the editor is drag-resizable too (its own width).
  const [clipRailW, setClipRailW] = usePersistentNumber("web-daw:clip-rail-width", 96, 72, 260);
  const clipRailRef = useRef<HTMLDivElement>(null);

  // The device rack is the fixed-height one and the editor above it is flexible, so an
  // undersized body would let the rack take everything and leave the editor zero
  // pixels. Measure the body and clamp the rack against it - the same guard the desktop
  // shell puts on the timeline height.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBodyH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const effDeviceH = bodyH
    ? Math.min(deviceH, Math.max(Math.round(bodyH * RACK_SHARE_WHEN_TIGHT), bodyH - MIN_EDITOR))
    : deviceH;

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
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted hover:text-strong hover:bg-panel cursor-pointer"
        >
          <span className="text-lg leading-none">«</span>
        </button>
      )}
    </div>
  );

  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="flex items-center h-11 border-b border-line bg-frame shrink-0">{indicators}</div>
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
    <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
      {/* The selected track is a single editor tab (reserving space for future
          multi-window tabs); it carries the track name + kind chip. The agent-expand
          control sits at the far right of the tab bar. */}
      <div
        className="flex items-stretch h-11 border-b border-line bg-frame shrink-0"
        role="tablist"
        aria-label="Open editors"
      >
        {/* No fill on the active tab: the bar is its own surface (`frame`) and the teal underline
            is what marks selection. A lighter chip here was the one thing lifting off it. */}
        <div className="relative flex items-center gap-2 h-full pl-3.5 pr-4 border-r border-line max-w-72">
          <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-you" />
          <span className="w-2 h-2 rounded-full bg-you shrink-0" />
          <InlineRename
            value={selectedTrack.name}
            onCommit={(name) => dispatch({ type: "setTrack", trackId: selectedTrack.id, name })}
            className="font-semibold text-sm text-strong"
          />
          <span className="font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">{kindLabel}</span>
        </div>
        {indicators}
      </div>

      {/* Measured so the fixed-height device rack can be clamped against it. */}
      {/* The clip rail runs the full height of the workbench, and the notes surface and the
          device rack stack in the column beside it. That keeps the two panels left-aligned
          with each other, and puts the record button at the bottom of the rail rather than
          floating under the last clip. */}
      <div ref={bodyRef} className="flex-1 min-h-0 min-w-0 flex" key={`${selectedTrack.id}:body`}>
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

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <TrackEditor
            track={selectedTrack}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            projectStore={projectStore}
          />

          {/* The device rack sits below the notes (resizable height, drag its top edge),
              so the flow reads notes -> instrument -> effects -> output. Same card as the
              notes surface: both are panels on the workbench, not one panel and one band. */}
          <div
            ref={deviceRef}
            className="relative shrink-0 flex flex-col px-3 pb-3"
            style={{ height: effDeviceH }}
            key={`${selectedTrack.id}:dev`}
          >
            <ResizeHandle
              ariaLabel="Resize devices"
              orientation="horizontal"
              onResize={(y) => setDeviceH((deviceRef.current?.getBoundingClientRect().bottom ?? 0) - y)}
              style={{ left: 0, right: 0, top: 0 }}
            />
            <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-line bg-stage overflow-hidden">
              <DeviceRack
                track={selectedTrack}
                samples={project.samples}
                dispatch={dispatch}
                projectStore={projectStore}
                onRevealSamples={onRevealSamples}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
