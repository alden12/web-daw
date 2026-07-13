/**
 * The app shell. Owns the project (tracks), the AudioEngine, and the Scheduler;
 * handles the audio-start gesture and computer-keyboard input (to the selected
 * track); restores/persists the project; bridges to MCP; and lays everything out
 * in the video-editor spine (activity rail + library | center | agent, timeline).
 * The library rail switches a single view; the panel header carries the app chrome
 * (search, MCP, undo/redo) so there is no separate top toolbar.
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
import { ActivityRail, type LibraryView } from "./ActivityRail";
import { CenterWorkbench } from "./CenterWorkbench";
import { AgentPanel } from "./AgentPanel";
import { ArrangementTimeline } from "./ArrangementTimeline";
import { ResizeHandle } from "./ResizeHandle";
import { StartDialog } from "./StartDialog";
import { usePersistentBoolean, usePersistentNumber, usePersistentString } from "./usePersistent";
import { readAutoQuantize } from "./quantizeSettings";

// Layout bounds. The activity rail is always shown on the left; the library panel
// beside it collapses to that rail. The agent pane collapses away entirely (its
// expand control lives in the workbench tab bar). The timeline can grow until only
// MIN_CENTER of the workbench remains.
const RAIL_WIDTH = 48;
const MIN_CENTER = 96;
const LIBRARY_VIEWS = ["search", "project", "instruments", "effects", "patches", "samples", "activity"] as const;

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

  // Resizable, persisted side panels + collapse state. The activity rail chooses
  // which single library view shows beside it; clicking the active icon collapses
  // the panel to the rail.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [libWidth, setLibWidth] = usePersistentNumber("web-daw:lib-width", 200, 150, 420);
  const [agentWidth, setAgentWidth] = usePersistentNumber("web-daw:agent-width", 320, 240, 620);
  const [timelineH, setTimelineH] = usePersistentNumber("web-daw:timeline-height", 244, 120, 2000);
  const [libCollapsed, setLibCollapsed] = usePersistentBoolean("web-daw:lib-collapsed", false);
  const [libView, setLibView] = usePersistentString<LibraryView>("web-daw:lib-view", "instruments", LIBRARY_VIEWS);
  const [agentCollapsed, setAgentCollapsed] = usePersistentBoolean("web-daw:agent-collapsed", true);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);

  // Rail interaction: a non-active icon selects its view (opening the panel if
  // collapsed); the active icon toggles the panel collapsed.
  const selectView = (view: LibraryView) => {
    setLibView(view);
    if (libCollapsed) setLibCollapsed(false);
  };

  // Typing in the panel's search box jumps to the Search results view (remembering
  // the view it left, so emptying the box returns there); opens the panel if collapsed.
  const preSearchView = useRef<LibraryView | null>(null);
  const onSearch = (query: string) => {
    setSearch(query);
    if (query.trim()) {
      if (libView !== "search") {
        preSearchView.current = libView;
        selectView("search");
      }
    } else if (libView === "search" && preSearchView.current) {
      setLibView(preSearchView.current);
      preSearchView.current = null;
    }
  };

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
        <ActivityRail
          active={libView}
          collapsed={libCollapsed}
          onSelect={selectView}
          onToggleCollapse={() => setLibCollapsed(!libCollapsed)}
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
          />
        )}
        <CenterWorkbench
          projectStore={projectStore}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          selectedTrack={selectedTrack}
          onRevealSamples={() => selectView("samples")}
          mcpStatus={mcpStatus}
          agentCollapsed={agentCollapsed}
          onExpandAgent={() => setAgentCollapsed(false)}
        />
        {!agentCollapsed && <AgentPanel onCollapse={() => setAgentCollapsed(true)} />}
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
      {!started && <StartDialog onStart={handleStart} />}
    </div>
  );
}
