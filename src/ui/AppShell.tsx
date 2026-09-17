/**
 * The app shell. Owns the project (tracks), the AudioEngine, and the Scheduler;
 * handles the audio-start gesture and computer-keyboard input (to the selected
 * track); restores/persists the project; bridges to MCP; and lays everything out
 * in the video-editor spine (activity rail + library | center | agent, timeline).
 * The library rail switches a single view; the panel header carries the app chrome
 * (search, MCP, undo/redo) so there is no separate top toolbar.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ProjectStore } from "../audio/project/projectStore";
import { AudioEngine } from "../audio/engine/AudioEngine";
import { Scheduler } from "../audio/sequencer/scheduler";
import { connectMcpBridge, type McpStatus } from "../audio/mcp/bridge";
import { Recorder } from "../audio/recording/recorder";
import { LiveNotes } from "../audio/live/liveNotes";
import { MidiInput } from "../audio/midi/midiInput";
import { attachAutosave } from "../audio/persistence";
import { initProjects, forkProjectFromSnapshot } from "../audio/projects/operations";
import { patchProjectName, listProjects, subscribeProjects } from "../audio/projects/library";
import { currentProjectId, setCurrentProject } from "../audio/projectRepository";
import { readCurrentUser, subscribeCurrentUser } from "./currentUser";
import { SharedSession } from "../audio/sync/sharedSession";
import type { ConflictInfo } from "../audio/sync/conflict";
import type { ProjectData } from "../audio/project/types";
import { bundleLocalMirror } from "../audio/sync/localMirror";
import { getLocalCacheBundle, requestPersistentStorage } from "../audio/bundleStore";
import { createWsClient, wsBaseFromApiUrl, type WsStatus } from "../contract/client";
import { OfflineBanner, LoadingOverlay } from "./ConnectionStatus";
import { ConflictDialog } from "./ConflictDialog";
import { getAccessToken } from "../auth/session";
import { VersionStore } from "../audio/commands/history";
import { useProject } from "../audio/project/useProject";
import { EditLog } from "../audio/commands/editLog";
import { LibraryPanel } from "./LibraryPanel";
import { ActivityRail, type LibraryView } from "./ActivityRail";
import { CenterWorkbench } from "./CenterWorkbench";
import { AgentPanel } from "./AgentPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SharePanel } from "./SharePanel";
import { AccountPanel } from "./AccountPanel";
import { useAgentConfig } from "./useAgentConfig";
import { useAuthorColors, useSyncAuthorColorVars } from "./useAuthorColors";
import { AuthorColorsProvider } from "./authorColorsContext";
import { activeKey } from "../audio/agent/config";
import { ArrangementTimeline } from "./ArrangementTimeline";
import { ResizeHandle } from "./ResizeHandle";
import { StartDialog } from "./StartDialog";
import { usePersistentBoolean, usePersistentNumber, usePersistentString } from "./usePersistent";
import { readAutoQuantize } from "./quantizeSettings";
import { readRecordOffsetMs } from "./recordOffset";
import { readOutputDeviceId } from "./outputDevice";

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

// Non-text inputs (checkbox / radio / range / button ...) don't consume typed text, so
// keyboard shortcuts and computer-keyboard playing should keep working while one is
// focused. Only genuine text entry (text inputs, textareas, selects, contentEditable)
// should swallow keys. Fixes toggles blocking keyboard play after you click them.
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName === "INPUT") return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  return false;
}

export function AppShell() {
  const [projectStore] = useState(() => new ProjectStore());
  const [engine] = useState(() => new AudioEngine());
  const [editLog] = useState(() => new EditLog(projectStore));
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduler] = useState(() => new Scheduler(engine, projectStore, setIsPlaying));
  // MIDI devices read the transport (tempo/beat grid/playing) through the scheduler. Wire it before
  // any device is built (engine.start happens on a later user gesture, so this effect runs first).
  useEffect(() => engine.setTransportClock(scheduler), [engine, scheduler]);
  const [recorder] = useState(
    () => new Recorder(engine, scheduler, projectStore, editLog.dispatch, readAutoQuantize, readRecordOffsetMs),
  );
  // Live-note routing (selected instrument + recorder + sustain), shared by the
  // computer keyboard and hardware MIDI so both get velocity and pedal handling.
  const [liveNotes] = useState(() => new LiveNotes(engine, projectStore, recorder));
  const [midiInput] = useState(
    () =>
      new MidiInput({
        onNoteOn: (note, velocity) => liveNotes.noteOn(note, velocity),
        onNoteOff: (note) => liveNotes.noteOff(note),
        onSustain: (down) => liveNotes.setSustain(down),
      }),
  );
  const [mcpStatus, setMcpStatus] = useState<McpStatus>("connecting");
  // Sync-connection state (remote mode only; null in local/no-sync mode). `projectLoaded` gates the
  // load overlay; `sawPeerEdit` marks the project as collaborative so the offline banner warns.
  const [syncStatus, setSyncStatus] = useState<WsStatus | null>(null);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [sawPeerEdit, setSawPeerEdit] = useState(false);
  // A reconnect conflict awaiting the user's choice (remote mode only). Held by the shared session; the
  // dialog resolves it. `sessionRef` lets the dialog call back into the live session.
  const [conflict, setConflict] = useState<{ info: ConflictInfo; myState: ProjectData } | null>(null);
  const sessionRef = useRef<SharedSession | null>(null);
  const projectList = useSyncExternalStore(subscribeProjects, listProjects);
  // Shared = someone shared it with us (role "editor") or we have seen a peer edit this session (so an
  // owner with active collaborators warns too). Owner-with-idle-members isn't caught yet - a cheap
  // server "shared" flag on the listing would close that; deferred to the conflict-flow increment.
  const isSharedProject = sawPeerEdit || projectList.find((meta) => meta.id === currentProjectId())?.role === "editor";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The project being shared (its id + name), or null when the Share panel is closed.
  const [share, setShare] = useState<{ id: string; name: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const agentConfig = useAgentConfig();
  const authorColors = useAuthorColors();
  useSyncAuthorColorVars(authorColors);
  // The current user id (default "you"), stamped on local edits and used to paint *my* edits as the
  // "you" hue while peers get their own colour (perspective-relative; see authorColors.ts).
  const currentUser = useSyncExternalStore(subscribeCurrentUser, readCurrentUser, readCurrentUser);

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

  // Stamp local edits with the current user id, so in a shared session each user's edits carry their
  // identity (and colour). Temporary until real auth supplies the id.
  useEffect(() => editLog.setLocalAuthor(currentUser), [editLog, currentUser]);

  const project = useProject(projectStore);
  const selectedTrack = project.selectedTrackId ? projectStore.getTrack(project.selectedTrackId) : undefined;

  const versionStore = useMemo(() => new VersionStore(projectStore, editLog), [projectStore, editLog]);

  // Open the current project from the multi-project library (enumerates bundles,
  // seeds the first project on a fresh install, and loads the persisted current one
  // + its version history), then autosave on any change and auto-checkpoint. Async
  // (OPFS); autosave/checkpoints attach only after, to avoid a redundant re-save.
  useEffect(() => {
    let active = true;
    let disposePersistence = () => {};
    let disposeCheckpoints = () => {};
    // Best-effort: keep the offline cache + write-queue from being evicted under storage pressure.
    void requestPersistentStorage();
    void initProjects({ projectStore, editLog, versionStore })
      .then(() => {
        if (!active) return;
        // With a remote backend, edits ride the live WS channel and the authority persists them (the
        // client no longer appends over HTTP): open a shared session and route each dispatched edit to it.
        // Local-only backend keeps the HTTP/OPFS autosave. Version-history checkpoints stay client-side
        // either way until Phase B moves them server-side.
        const apiUrl = import.meta.env?.VITE_DAW_API_URL;
        if (apiUrl) {
          const entries = editLog.getEntries();
          const notes = editLog.getNotes();
          const baseSeq = Math.max(-1, ...entries.map((entry) => entry.seq), ...notes.map((note) => note.seq));
          const transport = createWsClient({
            baseUrl: wsBaseFromApiUrl(apiUrl),
            token: getAccessToken, // the live session token (getter), so a reconnect uses a refreshed one
          });
          transport.onStatus((status) => {
            if (active) setSyncStatus(status);
          });
          // Durable OPFS mirror (cache-only) so offline edits survive a reload and the confirmed stream
          // replays offline. Null when OPFS is unavailable (remote-only, no offline durability).
          const cacheBundle = getLocalCacheBundle(currentProjectId());
          const session = new SharedSession({
            projectStore,
            editLog,
            transport,
            projectId: currentProjectId(),
            baseSeq,
            localMirror: cacheBundle ? bundleLocalMirror(cacheBundle) : undefined,
            onError: (message) => console.warn(`[web-daw] sync: ${message}`),
            // A peer's edit: mark the project collaborative (so the offline banner warns), and on a rename
            // update our library-list label straight from the edit (the store already applied it) so the
            // dropdown reflects it live without a reload.
            onRemoteEdit: (command) => {
              if (active) setSawPeerEdit(true);
              if (command.type === "renameProject") patchProjectName(currentProjectId(), command.name);
            },
            // A reconnect clash: the session is holding our offline edits and showing the peer's state.
            // Raise it to the dialog, which resolves via `discardPending` (take theirs) or a fork (keep mine).
            onConflict: (info, myState) => {
              if (active) setConflict({ info, myState });
            },
            // The authoritative log advanced: refresh server-side version history from its markers.
            onConfirmed: () => void versionStore.onLogAdvanced(),
          });
          session.attach();
          // Server-authoritative history: author commits/reverts through the session and derive the
          // version list from the log (not the client file-DAG). Set before `attach()` below so the
          // client-side auto-checkpoint no-ops in remote mode.
          versionStore.setRemote(session);
          sessionRef.current = session;
          disposePersistence = () => {
            sessionRef.current = null;
            versionStore.setRemote(null);
            session.close();
          };
        } else {
          disposePersistence = attachAutosave(projectStore, editLog);
        }
        disposeCheckpoints = versionStore.attach();
      })
      .catch((error) => console.warn("[web-daw] project load failed:", error))
      .finally(() => {
        if (active) setProjectLoaded(true);
      });
    return () => {
      active = false;
      disposePersistence();
      disposeCheckpoints();
    };
  }, [projectStore, editLog, versionStore]);

  useEffect(
    () => () => {
      midiInput.disable();
      recorder.dispose();
      scheduler.dispose();
      engine.dispose();
    },
    [midiInput, recorder, scheduler, engine],
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
      if (isTypingTarget(e.target)) return;
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
      if (isTypingTarget(e.target)) return;
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

  // Computer-keyboard plays the selected track's instrument (polyphonic) through the
  // shared live-note router, which handles per-note instrument routing and sustain.
  useEffect(() => {
    if (!started) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return; // don't play while typing (but toggles/knobs are fine)
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi !== undefined) liveNotes.noteOn(midi);
    };
    const onUp = (e: KeyboardEvent) => {
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi !== undefined) liveNotes.noteOff(midi);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [started, liveNotes]);

  const handleStart = async () => {
    await engine.start(projectStore);
    setStarted(true);
    // Route to the remembered output device (if any) now that the context exists.
    const outputId = readOutputDeviceId();
    if (outputId) void engine.setOutputDevice(outputId);
    // Best-effort: pick up a plugged-in MIDI keyboard from this user gesture. If the
    // browser blocks it (or has no Web MIDI), the MIDI settings tab shows the state.
    void midiInput.enable();
  };

  return (
    <AuthorColorsProvider value={{ config: authorColors, self: currentUser }}>
      <div className="flex flex-col h-screen overflow-hidden bg-ground text-ink">
        {syncStatus === "offline" && <OfflineBanner shared={!!isSharedProject} />}
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
            onSelect={selectView}
            onToggleCollapse={() => setLibCollapsed(!libCollapsed)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAccount={() => setAccountOpen(true)}
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
              onOpenShare={(id, name) => setShare({ id, name })}
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
            syncStatus={syncStatus}
            agentCollapsed={agentCollapsed}
            onExpandAgent={() => setAgentCollapsed(false)}
          />
          {!agentCollapsed && (
            <AgentPanel
              onCollapse={() => setAgentCollapsed(true)}
              projectStore={projectStore}
              dispatch={dispatch}
              scheduler={scheduler}
              hasApiKey={activeKey(agentConfig) !== ""}
              onOpenSettings={() => setSettingsOpen(true)}
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
        {settingsOpen && (
          <SettingsPanel
            agentConfig={agentConfig}
            authorColors={authorColors}
            editLog={editLog}
            midiInput={midiInput}
            recorder={recorder}
            engine={engine}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {share && <SharePanel projectId={share.id} projectName={share.name} onClose={() => setShare(null)} />}
        {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} />}
        {!started && <StartDialog onStart={handleStart} />}
        {!projectLoaded && <LoadingOverlay />}
        {conflict && (
          <ConflictDialog
            info={conflict.info}
            onTakeTheirs={() => {
              sessionRef.current?.discardPending(); // drop our held edits; converge on the peer's version
              setConflict(null);
            }}
            onKeepMine={() => {
              const { myState } = conflict;
              void (async () => {
                try {
                  // Fork a copy carrying our offline edits, then converge the shared project on the peer's
                  // version and reload into the copy (a fresh session attaches to the new project).
                  const id = await forkProjectFromSnapshot(myState, `${myState.name} (copy)`);
                  await sessionRef.current?.discardPending(); // durably clear the original's held queue first
                  setCurrentProject(id);
                  window.location.reload();
                } catch (error) {
                  console.warn("[web-daw] keep-mine fork failed:", error);
                }
              })();
            }}
          />
        )}
      </div>
    </AuthorColorsProvider>
  );
}
