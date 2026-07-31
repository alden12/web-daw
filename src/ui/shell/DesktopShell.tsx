/**
 * The desktop shell: the video-editor spine (activity rail + library | center | agent,
 * with the arrangement timeline as a full-width band along the bottom). Lifted out of
 * `AppShell` when the touch shell arrived (MOBILE-1) - `AppShell` owns the stores and
 * the engine, and each shell is a pure layout over `ShellProps`.
 *
 * Everything private to this file is geometry: the three resizable, persisted splits
 * and the measured body height that keeps the timeline from crowding out the workbench.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ActivityRail } from "../ActivityRail";
import { LibraryPanel } from "../LibraryPanel";
import { CenterWorkbench } from "../CenterWorkbench";
import { AgentPanel } from "../AgentPanel";
import { ArrangementTimeline } from "../ArrangementTimeline";
import { ResizeHandle } from "../ResizeHandle";
import { usePersistentNumber } from "../usePersistent";
import type { ShellProps } from "./types";

// Layout bounds. The activity rail is always shown on the left; the library panel
// beside it collapses to that rail. The agent pane collapses away entirely (its
// expand control lives in the workbench tab bar). The timeline can grow until only
// MIN_CENTER of the workbench remains.
const RAIL_WIDTH = 48;
const MIN_CENTER = 96;

export function DesktopShell({
  projectStore,
  scheduler,
  recorder,
  editLog,
  versionStore,
  dispatch,
  selectedTrack,
  isPlaying,
  started,
  mcpStatus,
  syncStatus,
  hasApiKey,
  libView,
  onSelectView,
  search,
  onSearch,
  libCollapsed,
  onToggleLibCollapsed,
  agentCollapsed,
  onSetAgentCollapsed,
  onOpenSettings,
  onOpenAccount,
  onOpenShare,
}: ShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [libWidth, setLibWidth] = usePersistentNumber("web-daw:lib-width", 200, 150, 420);
  const [agentWidth, setAgentWidth] = usePersistentNumber("web-daw:agent-width", 320, 240, 620);
  const [timelineH, setTimelineH] = usePersistentNumber("web-daw:timeline-height", 244, 120, 2000);
  const [dragging, setDragging] = useState(false);

  // Track the body height so the timeline can never crowd out the workbench:
  // the effective height is clamped to leave at least MIN_CENTER up top, which
  // also heals a stale/oversized persisted value and adapts on window resize.
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

  const effTimelineH = bodyH ? Math.min(timelineH, bodyH - MIN_CENTER) : timelineH;
  // The rail is its own full-height column (spans both rows), then the library panel
  // (collapses to 0), the center, and the agent (collapses to 0). `libColRight` is the
  // panel's right edge (rail + panel), where its resize handle sits.
  const libColRight = RAIL_WIDTH + (libCollapsed ? 0 : libWidth);
  const gridCols = `${RAIL_WIDTH}px ${libCollapsed ? 0 : libWidth}px minmax(0, 1fr) ${agentCollapsed ? 0 : agentWidth}px`;
  const gridRows = `minmax(0, 1fr) ${effTimelineH}px`;
  const bodyRect = () => bodyRef.current?.getBoundingClientRect();
  const bodyLeft = () => bodyRect()?.left ?? 0;
  const bodyRight = () => bodyRect()?.right ?? 0;

  return (
    <div
      ref={bodyRef}
      className="app-body flex-1 min-h-0 relative"
      style={{
        gridTemplateColumns: gridCols,
        gridTemplateRows: gridRows,
        transition: dragging ? "none" : undefined,
      }}
    >
      <ActivityRail
        active={libView}
        collapsed={libCollapsed}
        onSelect={onSelectView}
        onToggleCollapse={onToggleLibCollapsed}
        onOpenSettings={onOpenSettings}
        onOpenAccount={onOpenAccount}
      />
      {!libCollapsed && (
        <LibraryPanel
          projectStore={projectStore}
          editLog={editLog}
          versionStore={versionStore}
          dispatch={dispatch}
          activeView={libView}
          search={search}
          onSearch={onSearch}
          onOpenShare={onOpenShare}
        />
      )}
      <CenterWorkbench
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        selectedTrack={selectedTrack}
        onRevealSamples={() => onSelectView("samples")}
        mcpStatus={mcpStatus}
        syncStatus={syncStatus}
        agentCollapsed={agentCollapsed}
        onExpandAgent={() => onSetAgentCollapsed(false)}
      />
      {!agentCollapsed && (
        <AgentPanel
          onCollapse={() => onSetAgentCollapsed(true)}
          projectStore={projectStore}
          dispatch={dispatch}
          scheduler={scheduler}
          hasApiKey={hasApiKey}
          onOpenSettings={onOpenSettings}
        />
      )}
      <ArrangementTimeline
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        isPlaying={isPlaying}
        started={started}
      />

      {!libCollapsed && (
        <ResizeHandle
          ariaLabel="Resize library"
          onDragChange={setDragging}
          onResize={(x) => setLibWidth(x - bodyLeft() - RAIL_WIDTH)}
          style={{ left: libColRight - 3, top: 0, bottom: effTimelineH }}
        />
      )}
      {!agentCollapsed && (
        <ResizeHandle
          ariaLabel="Resize agent panel"
          onDragChange={setDragging}
          onResize={(x) => setAgentWidth(bodyRight() - x)}
          style={{ right: agentWidth - 3, top: 0, bottom: effTimelineH }}
        />
      )}
      <ResizeHandle
        ariaLabel="Resize timeline"
        orientation="horizontal"
        onDragChange={setDragging}
        onResize={(y) => {
          const rect = bodyRect();
          if (rect) setTimelineH(Math.min(rect.height - MIN_CENTER, rect.bottom - y));
        }}
        // Sit fully above the timeline's top edge, not straddling it, so it never
        // covers the ruler's loop-region markers (which would steal their drags).
        // Starts after the full-height rail (the timeline no longer spans it).
        style={{ left: RAIL_WIDTH, right: 0, bottom: effTimelineH }}
      />
    </div>
  );
}
