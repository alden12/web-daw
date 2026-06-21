/**
 * The app shell. Owns the project (tracks), the AudioEngine, and the Scheduler;
 * handles the audio-start gesture and computer-keyboard input (to the selected
 * track); restores/persists the project; bridges to MCP; and lays everything out
 * in the four-region video-editor spine (top bar, library | center | agent,
 * timeline). All the wiring is unchanged from the old SynthPanel - this slice is
 * presentation only.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ProjectStore } from '../audio/project/projectStore';
import { AudioEngine } from '../audio/engine/AudioEngine';
import { Scheduler } from '../audio/sequencer/scheduler';
import { connectMcpBridge, type McpStatus } from '../audio/mcp/bridge';
import { attachAutosave, restoreProject } from '../audio/persistence';
import { useProject } from '../audio/project/useProject';
import { EditLog } from '../audio/commands/editLog';
import { TopBar } from './TopBar';
import { LibraryPanel } from './LibraryPanel';
import { CenterWorkbench } from './CenterWorkbench';
import { AgentPanel } from './AgentPanel';
import { ArrangementTimeline } from './ArrangementTimeline';
import { ResizeHandle } from './ResizeHandle';
import { StartDialog } from './StartDialog';
import { usePersistentBoolean, usePersistentNumber } from './usePersistent';

// Layout bounds. The agent pane collapses to a thin rail (Produce mode); the
// timeline can grow until only MIN_CENTER of the workbench remains.
const AGENT_RAIL = 52;
const MIN_CENTER = 96;

// Computer-keyboard -> MIDI note, one octave from C4 (the classic tracker layout).
const KEY_MAP: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};

export function AppShell() {
  const [projectStore] = useState(() => new ProjectStore());
  const [engine] = useState(() => new AudioEngine());
  const [editLog] = useState(() => new EditLog(projectStore));
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduler] = useState(() => new Scheduler(engine, projectStore, setIsPlaying));
  const [mcpStatus, setMcpStatus] = useState<McpStatus>('connecting');
  const dispatch = editLog.dispatch;

  // Resizable, persisted side panels + agent collapse (replaces the old mode toggle).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [libWidth, setLibWidth] = usePersistentNumber('web-daw:lib-width', 200, 150, 420);
  const [agentWidth, setAgentWidth] = usePersistentNumber('web-daw:agent-width', 320, 240, 620);
  const [timelineH, setTimelineH] = usePersistentNumber('web-daw:timeline-height', 244, 120, 2000);
  const [agentCollapsed, setAgentCollapsed] = usePersistentBoolean('web-daw:agent-collapsed', false);
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
  const gridCols = `${libWidth}px minmax(0, 1fr) ${agentCollapsed ? AGENT_RAIL : agentWidth}px`;
  const gridRows = `minmax(0, 1fr) ${effTimelineH}px`;
  const bodyRect = () => bodyRef.current?.getBoundingClientRect();
  const bodyLeft = () => bodyRect()?.left ?? 0;
  const bodyRight = () => bodyRect()?.right ?? 0;

  const project = useProject(projectStore);
  const selectedTrack = project.selectedTrackId ? projectStore.getTrack(project.selectedTrackId) : undefined;

  // Restore the saved project, then autosave on any change (runs before the
  // bridge connects, so the first snapshot reflects the restored project).
  useEffect(() => {
    restoreProject(projectStore);
    return attachAutosave(projectStore);
  }, [projectStore]);

  useEffect(() => () => {
    scheduler.dispose();
    engine.dispose();
  }, [scheduler, engine]);

  useEffect(() => {
    const handle = connectMcpBridge({ projectStore, engine, scheduler, editLog }, { onStatus: setMcpStatus });
    return () => handle.dispose();
  }, [projectStore, engine, scheduler, editLog]);

  // Undo / redo (Cmd/Ctrl-Z, Shift+Cmd/Ctrl-Z), unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) editLog.redo();
      else editLog.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editLog]);

  // Computer-keyboard plays the selected track's instrument (polyphonic).
  useEffect(() => {
    if (!started) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const midi = KEY_MAP[e.key.toLowerCase()];
      const id = projectStore.selectedId;
      if (midi !== undefined && id) engine.getInstrument(id)?.noteOn(midi);
    };
    const onUp = (e: KeyboardEvent) => {
      const midi = KEY_MAP[e.key.toLowerCase()];
      const id = projectStore.selectedId;
      if (midi !== undefined && id) engine.getInstrument(id)?.noteOff(midi);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [started, projectStore, engine]);

  const handleStart = async () => {
    await engine.start(projectStore);
    setStarted(true);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-ground text-ink">
      <TopBar
        projectStore={projectStore}
        scheduler={scheduler}
        editLog={editLog}
        dispatch={dispatch}
        isPlaying={isPlaying}
        started={started}
        mcpStatus={mcpStatus}
        agentCollapsed={agentCollapsed}
        onToggleAgent={() => setAgentCollapsed(!agentCollapsed)}
      />
      <div
        ref={bodyRef}
        className="app-body flex-1 min-h-0 relative"
        style={{ gridTemplateColumns: gridCols, gridTemplateRows: gridRows, transition: dragging ? 'none' : undefined }}
      >
        <LibraryPanel projectStore={projectStore} dispatch={dispatch} />
        <CenterWorkbench projectStore={projectStore} scheduler={scheduler} dispatch={dispatch} selectedTrack={selectedTrack} />
        <AgentPanel
          mcpStatus={mcpStatus}
          editLog={editLog}
          collapsed={agentCollapsed}
          onToggle={() => setAgentCollapsed(!agentCollapsed)}
        />
        <ArrangementTimeline projectStore={projectStore} scheduler={scheduler} dispatch={dispatch} />

        <ResizeHandle
          ariaLabel="Resize library"
          onDragChange={setDragging}
          onResize={(x) => setLibWidth(x - bodyLeft())}
          style={{ left: libWidth - 3, top: 0, bottom: effTimelineH }}
        />
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
          style={{ left: 0, right: 0, bottom: effTimelineH - 3 }}
        />
      </div>
      {!started && <StartDialog onStart={handleStart} />}
    </div>
  );
}
