/**
 * The app shell. Owns the project (tracks), the AudioEngine, and the Scheduler;
 * handles the audio-start gesture and computer-keyboard input (to the selected
 * track); restores/persists the project; bridges to MCP; and lays everything out
 * in the four-region video-editor spine (top bar, library | center | agent,
 * timeline). All the wiring is unchanged from the old SynthPanel - this slice is
 * presentation only.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProjectStore } from "../audio/project/projectStore";
import { AudioEngine } from "../audio/engine/AudioEngine";
import { Scheduler } from "../audio/sequencer/scheduler";
import { connectMcpBridge, type McpStatus } from "../audio/mcp/bridge";
import { Recorder } from "../audio/recording/recorder";
import { attachAutosave } from "../audio/persistence";
import { initProjects } from "../audio/projects/operations";
import { VersionStore } from "../audio/commands/history";
import { useProject } from "../audio/project/useProject";
import { EditLog } from "../audio/commands/editLog";
import { LibraryPanel } from "./LibraryPanel";
import { CenterWorkbench } from "./CenterWorkbench";
import { AgentPanel } from "./AgentPanel";
import { ArrangementTimeline } from "./ArrangementTimeline";
import { ResizeHandle } from "./ResizeHandle";
import { StartDialog } from "./StartDialog";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";
import { readAutoQuantize } from "./quantizeSettings";

// Layout bounds. The agent pane collapses to a thin rail (Produce mode); the
// timeline can grow until only MIN_CENTER of the workbench remains.
const AGENT_RAIL = 52;
const MIN_CENTER = 96;

// Computer-keyboard -> MIDI note, one octave from C4 (the classic tracker layout).
const KEY_MAP: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
};

export function AppShell() {
  const [projectStore] = useState(() => new ProjectStore());
  const [engine] = useState(() => new AudioEngine());
  const [editLog] = useState(() => new EditLog(projectStore));
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduler] = useState(() => new Scheduler(engine, projectStore, setIsPlaying));
  const [recorder] = useState(() => new Recorder(engine, scheduler, projectStore, editLog.dispatch, readAutoQuantize));
  const [mcpStatus, setMcpStatus] = useState<McpStatus>("connecting");
  const dispatch = editLog.dispatch;

  // Resizable, persisted side panels + agent collapse (replaces the old mode toggle).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [libWidth, setLibWidth] = usePersistentNumber("web-daw:lib-width", 200, 150, 420);
  const [agentWidth, setAgentWidth] = usePersistentNumber("web-daw:agent-width", 320, 240, 620);
  const [timelineH, setTimelineH] = usePersistentNumber("web-daw:timeline-height", 244, 120, 2000);
  const [agentCollapsed, setAgentCollapsed] = usePersistentBoolean("web-daw:agent-collapsed", false);
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

  const versionStore = useMemo(() => new VersionStore(projectStore, editLog), [projectStore, editLog]);

  // Open the current project from the multi-project library (enumerates bundles,
  // seeds the first project on a fresh install, and loads the persisted current one
  // + its version history), then autosave on any change and auto-checkpoint. Async
  // (OPFS); autosave/checkpoints attach only after, to avoid a redundant re-save.
  useEffect(() => {
    let active = true;
    let disposeAutosave = () => {};
    let disposeCheckpoints = () => {};
    void initProjects({ projectStore, editLog, versionStore }).then(() => {
      if (!active) return;
      disposeAutosave = attachAutosave(projectStore, editLog);
      disposeCheckpoints = versionStore.attach();
    });
    return () => {
      active = false;
      disposeAutosave();
      disposeCheckpoints();
    };
  }, [projectStore, editLog, versionStore]);

  useEffect(
    () => () => {
      recorder.dispose();
      scheduler.dispose();
      engine.dispose();
    },
    [recorder, scheduler, engine],
  );

  useEffect(() => {
    const handle = connectMcpBridge(
      { projectStore, engine, scheduler, editLog, versionStore },
      { onStatus: setMcpStatus },
    );
    return () => handle.dispose();
  }, [projectStore, engine, scheduler, editLog, versionStore]);

  // Undo / redo (Cmd/Ctrl-Z, Shift+Cmd/Ctrl-Z), unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) editLog.redo();
      else editLog.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editLog]);

  // Space anywhere toggles play/stop, unless typing in a field (scheduler.play
  // is a no-op until audio is started).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      if (scheduler.isPlaying) {
        if (recorder.isActive)
          void recorder.stop(); // finalize the take, not just stop
        else scheduler.stop();
      } else scheduler.play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheduler, recorder]);

  // Computer-keyboard plays the selected track's instrument (polyphonic). Each held
  // key remembers which instrument it started on, so its note-off routes back there
  // even if you change the selection mid-press (otherwise the held voice rings on).
  const heldKeys = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    if (!started) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // don't play while typing
      const midi = KEY_MAP[e.key.toLowerCase()];
      const id = projectStore.selectedId;
      if (midi === undefined || !id) return;
      heldKeys.current.set(midi, id);
      engine.getInstrument(id)?.noteOn(midi);
      recorder.noteOn(midi); // captured only while a MIDI take is recording
    };
    const onUp = (e: KeyboardEvent) => {
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi === undefined) return;
      // Release on the instrument the key started on, not the currently-selected one.
      const id = heldKeys.current.get(midi) ?? projectStore.selectedId;
      heldKeys.current.delete(midi);
      if (!id) return;
      engine.getInstrument(id)?.noteOff(midi);
      recorder.noteOff(midi);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [started, projectStore, engine, recorder]);

  const handleStart = async () => {
    await engine.start(projectStore);
    setStarted(true);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-ground text-ink">
      <div
        ref={bodyRef}
        className="app-body flex-1 min-h-0 relative"
        style={{ gridTemplateColumns: gridCols, gridTemplateRows: gridRows, transition: dragging ? "none" : undefined }}
      >
        <LibraryPanel projectStore={projectStore} editLog={editLog} versionStore={versionStore} dispatch={dispatch} />
        <CenterWorkbench
          projectStore={projectStore}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          selectedTrack={selectedTrack}
        />
        <AgentPanel
          mcpStatus={mcpStatus}
          editLog={editLog}
          versionStore={versionStore}
          collapsed={agentCollapsed}
          onToggle={() => setAgentCollapsed(!agentCollapsed)}
        />
        <ArrangementTimeline
          projectStore={projectStore}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          isPlaying={isPlaying}
          started={started}
        />

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
          // Sit fully above the timeline's top edge, not straddling it, so it never
          // covers the ruler's loop-region markers (which would steal their drags).
          style={{ left: 0, right: 0, bottom: effTimelineH }}
        />
      </div>
      {!started && <StartDialog onStart={handleStart} />}
    </div>
  );
}
