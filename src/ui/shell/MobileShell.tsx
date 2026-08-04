/**
 * The touch shell (MOBILE-1, restructured by MOBILE-5), used on phones and tablets and on
 * any window too narrow for the desktop grid. Same stores, same leaf panels - only the
 * layout differs.
 *
 * **Mobile is the desktop occluded, not the desktop split four ways.** This used to be
 * four bottom tabs, on the argument that they were the desktop's own surfaces rather than
 * navigation invented for mobile. That argument was right and it pointed somewhere better:
 * the desktop does not tab between them either, it *stacks and occludes* -
 * `CenterWorkbench` is editor-above-rack floating over the timeline. So the arrangement is
 * simply the background here, and the editor is an `EditorSheet` over it, thrown between
 * three detents (parked, half, covering all but the selected lane).
 *
 * That deleted three things rather than adding one: the tab bar (~56px of a phone, plus
 * the safe area), the `LaneStrip` special case (it existed only because the Edit tab took
 * the arrangement away, and the Full detent now *is* that strip), and the question of
 * where selection navigates to - it does not, because the arrangement never leaves.
 *
 * Because the arrangement and the editor are now mounted at the same time, exactly one of
 * them owns the shell's ⋮ at a time: `isActiveSurface` follows the detent, so the
 * arrangement keeps its snap and zoom while the sheet is parked and hands them over once
 * it is up.
 *
 * Library and agent are reached from the same ☰ / ✦ buttons at either end of the top bar,
 * but framed by device: a phone gets a sheet over the app, a tablet **docks** them as
 * columns beside the workspace, because it has the width and covering what you are
 * editing to pick an instrument for it is a phone compromise rather than a virtue.
 *
 * The top bar keeps only what you reach for mid-idea - record, play, undo, redo - and
 * everything else is behind ⋮, above the project's tempo, meter and metronome.
 *
 * Deliberately not here yet: pinch-zoom and long-press menus (MOBILE-2), clips and pads as
 * sections under the roll (MOBILE-6), and the select-then-handles editing model (MOBILE-7).
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { LibraryPanel } from "../LibraryPanel";
import { AgentPanel } from "../AgentPanel";
import { ArrangementTimeline } from "../ArrangementTimeline";
import { ClipRail } from "../ClipRail";
import { TransportBar } from "../TransportBar";
import { AccountAvatar } from "../AccountAvatar";
import { SettingsIcon } from "../ActivityRail";
import { Menu, type MenuItem } from "../Menu";
import { RAIL_ITEMS } from "../libraryViews";
import { TrackEditor } from "../workbench/TrackEditor";
import { DeviceRack } from "../workbench/DeviceRack";
import { TrackRecordButton } from "../workbench/TrackRecordButton";
import { useProject } from "../../audio/project/useProject";
import { useEditLog } from "../../audio/commands/useEditLog";
import { useRecorder } from "../useRecorder";
import { usePersistentBoolean } from "../usePersistent";
import { TIME_SIGNATURE_DENOMINATORS, TIME_SIGNATURE_NUMERATOR_RANGE } from "../../audio/project/schema";
import { readSurfaceControls, subscribeSurfaceControls } from "./surfaceControls";
import { detentsFor, type Detent } from "./detents";
import { EditorSheet } from "./EditorSheet";
import { Sheet } from "./Sheet";
import type { Track } from "../../audio/project/projectStore";
import type { ShellProps } from "./types";
import type { DeviceShape } from "./useDeviceShape";

/**
 * What the editor sheet is showing. Clips is here rather than a section under the roll for
 * now - that is MOBILE-6, and dropping the tab before building the section would leave a
 * phone with no way to switch take.
 */
type EditorSurface = "edit" | "clips" | "devices";

interface SurfaceItem {
  surface: EditorSurface;
  label: string;
}

/**
 * The meters worth a menu entry. The schema allows 1..32 beats per bar, but a submenu of
 * 32 is not a control - typing an arbitrary numerator stays a desktop and MCP affordance,
 * and the range is still the schema's, so this list can only ever be a subset of it.
 */
const COMMON_NUMERATORS = [2, 3, 4, 5, 6, 7, 9, 12].filter(
  (numerator) => numerator >= TIME_SIGNATURE_NUMERATOR_RANGE.min && numerator <= TIME_SIGNATURE_NUMERATOR_RANGE.max,
);

/**
 * Tempos worth a menu entry, for the same reason as the meters: a number field is a
 * desktop control, and a submenu cannot offer 20-300. Covers the usual ground in steps
 * you would actually reach for; the field on desktop and MCP still take any value.
 */
const TEMPO_STEPS = [70, 80, 90, 100, 110, 120, 128, 140, 150, 160, 174, 180];

const SURFACE_ITEMS: SurfaceItem[] = [
  { surface: "edit", label: "Edit" },
  { surface: "clips", label: "Clips" },
  { surface: "devices", label: "Rack" },
];

/** A square icon button sized for a finger, not a cursor. */
function BarButton({
  label,
  onClick,
  active,
  disabled,
  tint,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tint?: "agent";
  children: ReactNode;
}) {
  const colour = active
    ? tint === "agent"
      ? "text-agent border-agent/55 bg-agent/15"
      : "text-you border-you/55 bg-you/15"
    : tint === "agent"
      ? "text-agent/80 border-line bg-card"
      : "text-muted border-line bg-card";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${colour}`}
    >
      {children}
    </button>
  );
}

/** Undo / redo arrows, sized for the top bar. */
const UndoIcon = ({ flip = false }: { flip?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${flip ? "scale-x-[-1]" : ""}`}
  >
    <path d="M3 7h6.5a3.25 3.25 0 0 1 0 6.5H6" />
    <path d="M5.5 4 2.5 7l3 3" />
  </svg>
);

/**
 * The library's contents. The six rail views become a scrollable strip of chips - the
 * same `RAIL_ITEMS` data the desktop rail lays out vertically - with settings and the
 * account pinned at the bottom, where the rail also keeps them.
 *
 * Wrapper-agnostic on purpose: a phone hosts this in a `Sheet` over the app, a tablet
 * docks it as a column beside the workspace. Only the frame differs.
 */
function LibraryContent({
  onClose,
  libView,
  onSelectView,
  search,
  onSearch,
  projectStore,
  editLog,
  versionStore,
  dispatch,
  onOpenShare,
  onOpenSettings,
  onOpenAccount,
}: Pick<
  ShellProps,
  | "libView"
  | "onSelectView"
  | "search"
  | "onSearch"
  | "projectStore"
  | "editLog"
  | "versionStore"
  | "dispatch"
  | "onOpenShare"
  | "onOpenSettings"
  | "onOpenAccount"
> & { onClose: () => void }) {
  return (
    <>
      <div className="shrink-0 flex items-center gap-2 h-11 px-3 border-b border-line">
        <span className="text-[13px] font-semibold text-bright">Library</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close library"
          className="ml-auto flex items-center justify-center w-8 h-8 rounded-md text-muted text-lg leading-none cursor-pointer"
        >
          ✕
        </button>
      </div>
      <nav
        aria-label="Library views"
        className="shrink-0 flex items-center gap-1.5 px-2 py-2 border-b border-line bg-rail overflow-x-auto"
      >
        {RAIL_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onSelectView(item.view)}
            aria-current={item.view === libView}
            className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-full border font-mono text-[11px] cursor-pointer ${
              item.view === libView ? "border-you/55 bg-you/15 text-you" : "border-line text-muted"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
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
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-t border-line">
        <span className="w-10 shrink-0 empty:hidden">
          <AccountAvatar onClick={onOpenAccount} />
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className="ml-auto flex items-center justify-center w-10 h-10 rounded-md text-muted cursor-pointer"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>
    </>
  );
}

/** A docked side column on a tablet: the same contents a phone gets in a sheet. */
function DockedPanel({ side, label, children }: { side: "left" | "right"; label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      className={`shrink-0 flex flex-col min-h-0 bg-panel ${
        side === "left" ? "w-72 border-r" : "w-84 border-l"
      } border-line`}
    >
      {children}
    </aside>
  );
}

export function MobileShell({
  shape,
  projectStore,
  scheduler,
  recorder,
  editLog,
  versionStore,
  dispatch,
  selectedTrack,
  isPlaying,
  started,
  hasApiKey,
  libView,
  onSelectView,
  search,
  onSearch,
  onOpenSettings,
  onOpenAccount,
  onOpenShare,
}: ShellProps & { shape: DeviceShape }) {
  /**
   * Detent and surface are **shell state, not the sheet's** (ARCH-3): they decide which
   * surface owns the ⋮, and MOBILE-6's sections will read the detent too. The sheet is
   * handed them and reports changes back.
   *
   * It opens at **Half**, and that follows from a property of the app rather than a taste:
   * there is always a track and a clip selected, so there is always something to edit and
   * showing it is not presuming. Opening parked was tried and reads as the editor having
   * failed to open - you land on a project, the thing you came to edit is a lip at the
   * bottom, and the tap that fixes that carries no information.
   *
   * **This flips if an empty selection ever becomes possible.** Nothing to edit means the
   * honest states are parked, or no sheet at all, and Half would then be the panel you did
   * not ask for. Keep the reasoning attached to the constraint, not to the number.
   */
  const [detent, setDetent] = useState<Detent>("half");
  const [surface, setSurface] = useState<EditorSurface>("edit");
  /**
   * A tablet opens with the library already docked: there is width for it beside the
   * workspace, and it is the first thing you reach for on a new project (add a track,
   * pick an instrument). Only where it *docks* - a phone, or a landscape phone sharing
   * the tablet tier, would open onto a full-screen overlay instead, which is a worse
   * first impression than an empty workspace. Same condition as `docked` below, read at
   * mount only, so toggling it later sticks.
   */
  const [libraryOpen, setLibraryOpen] = useState(() => shape.tier === "tablet" && !shape.short);
  const [agentOpen, setAgentOpen] = useState(false);
  const project = useProject(projectStore);
  /**
   * Raise on an *explicit* selection. State rather than a ref, and adjusted during render
   * rather than in an effect: this is React's documented "adjusting state when a prop
   * changes" pattern, so the re-render lands before the browser paints (no visible frame at
   * the old detent) and it stays safe under concurrent rendering, which a ref written
   * mid-render would not be.
   *
   * The test is **whether the track we last saw still exists**, not whether the id changed,
   * because a changed id does not mean anybody chose anything. Switching project is the case
   * that forces it: the tracks are replaced wholesale, so the selected id changes on its own.
   * A project swap takes the old track with it; selecting a lane or adding a track leaves it
   * standing. Deleting the selected track lands on a neighbour you did not ask for, and that
   * fails the test too, which is the behaviour we want.
   *
   * Raises only *from* parked, so a sheet already thrown to Full is left where you put it.
   * With Half the arrival default this now only fires after you have deliberately parked it.
   */
  const [lastSeenTrack, setLastSeenTrack] = useState<string | null>(selectedTrack?.id ?? null);
  if (selectedTrack && selectedTrack.id !== lastSeenTrack) {
    const sameProject = lastSeenTrack !== null && project.tracks.some((track) => track.id === lastSeenTrack);
    setLastSeenTrack(selectedTrack.id);
    if (sameProject && detent === "peek") setDetent("half");
  }

  /**
   * ...and raise on a lane tap that selects *nothing new*, which the rule above cannot see.
   * `selectTrack` is a no-op when the id already matches, so on a single-track project -
   * the state every new project starts in - tapping the only lane changed nothing and the
   * sheet stayed parked. Tapping a track means "edit this" whether or not it was already
   * selected.
   *
   * Reads the tap off the DOM rather than threading a callback down through the timeline:
   * `data-track-id` is already the timeline's own handle for a row (its scroll-into-view
   * finds rows by it), so this borrows an existing contract instead of adding a prop to a
   * component that does not otherwise care. Buttons opt out, as they do on the sheet's own
   * drag surface, so muting a track from its header does not also open the editor over it.
   */
  const onWorkspaceClick = (event: React.MouseEvent) => {
    if (detent !== "peek") return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select")) return;
    if (target.closest("[data-track-id]")) setDetent("half");
  };
  const rec = useRecorder(recorder);
  const recording = rec.status === "recording" || rec.status === "counting";
  // The compact transport drops the metronome button, so the shell's ⋮ owns it - reading
  // and writing the same persisted preference the desktop transport uses.
  const [metronome, setMetronome] = usePersistentBoolean("web-daw:metronome", false);
  const { canUndo, canRedo } = useEditLog(editLog);

  // The active surface's own controls, published by whichever workspace is mounted.
  const surfaceControls = useSyncExternalStore(subscribeSurfaceControls, readSurfaceControls, () => null);

  // Phone portrait has no room for a pinned header column in the arrangement; a tablet,
  // and a phone in landscape at ~844px, does.
  const isPhone = shape.tier === "phone";
  /**
   * On a tablet the library and agent **dock** beside the workspace instead of sliding
   * over it: there is width for a column, and covering the thing you are editing to pick
   * an instrument for it is a phone compromise, not a virtue. The same ☰ / ✦ buttons
   * toggle them either way, so only the presentation differs.
   *
   * Not on a phone in landscape: it lands in the same tier at ~844px but is only ~390px
   * tall, and a docked column there would leave the workspace a sliver.
   */
  const docked = shape.tier === "tablet" && !shape.short;

  const detents = detentsFor(shape);
  // The arrangement hands the ⋮ over once the sheet is up: both are mounted now, so
  // "compact" alone would have them both publishing and the later mount silently winning.
  const sheetIsUp = Boolean(selectedTrack) && detent !== "peek";

  // Surface -> the panel it hosts, as an object map so adding one is an entry here plus
  // one in SURFACE_ITEMS, and a missing case is a type error.
  const surfacesFor = (track: Track): Record<EditorSurface, ReactNode> => ({
    edit: (
      <TrackEditor
        track={track}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        projectStore={projectStore}
        compact
        isActiveSurface={sheetIsUp}
      />
    ),
    clips: (
      <div className="flex-1 min-h-0 flex flex-col">
        <ClipRail
          projectStore={projectStore}
          scheduler={scheduler}
          trackId={track.id}
          dispatch={dispatch}
          orientation="grid"
        />
        <div className="mt-auto shrink-0 p-3 border-t border-line">
          <TrackRecordButton trackId={track.id} recorder={recorder} recording={recording} />
        </div>
      </div>
    ),
    devices: (
      <div className="flex-1 min-h-0 flex flex-col">
        <DeviceRack
          track={track}
          samples={project.samples}
          dispatch={dispatch}
          projectStore={projectStore}
          onRevealSamples={() => {
            onSelectView("samples");
            setLibraryOpen(true);
          }}
        />
      </div>
    ),
  });

  // ⋮ - the active surface's own controls, then the project's. Two groups, so the menu's
  // contents stay predictable rather than becoming a junk drawer.
  //
  // The meter and the metronome are here because the compact transport drops them, which
  // also makes this their only writer (see TransportBar's `compact`).
  const meter = project.timeSignature;
  const setMeter = (patch: Partial<typeof meter>) =>
    dispatch({
      type: "setTimeSignature",
      numerator: patch.numerator ?? meter.numerator,
      denominator: patch.denominator ?? meter.denominator,
    });
  const projectItems: MenuItem[] = [
    {
      label: "Tempo",
      submenu: TEMPO_STEPS.map((bpm) => ({
        label: `${bpm} BPM`,
        checked: project.tempoBpm === bpm,
        onClick: () => dispatch({ type: "setTempo", bpm }),
      })),
    },
    {
      label: "Metronome",
      checked: metronome,
      onClick: () => {
        setMetronome(!metronome);
        scheduler.setMetronomeEnabled(!metronome);
      },
    },
    {
      label: `Meter · ${meter.numerator}/${meter.denominator}`,
      submenu: [
        {
          label: "Beats per bar",
          // Common meters, not all 32 - the range is the schema's, and typing an
          // arbitrary numerator stays a desktop/MCP affordance.
          submenu: COMMON_NUMERATORS.map((numerator) => ({
            label: String(numerator),
            checked: meter.numerator === numerator,
            onClick: () => setMeter({ numerator }),
          })),
        },
        {
          label: "Beat unit",
          submenu: TIME_SIGNATURE_DENOMINATORS.map((denominator) => ({
            label: String(denominator),
            checked: meter.denominator === denominator,
            onClick: () => setMeter({ denominator }),
          })),
        },
      ],
    },
  ];
  /**
   * A getter, not an array: the shell is not re-rendered when the active surface's own
   * state changes (the registry only notifies on mount/unmount, by design), so an array
   * built here would hold whatever was true at the shell's last unrelated render - a
   * "Velocity lane" tick still on after the lane was hidden, or a stale `disabled`.
   * `Menu` calls this while it is open, so the rows always reflect now.
   */
  const overflowItems = (): MenuItem[] =>
    surfaceControls ? [...surfaceControls(), { separator: true }, ...projectItems] : projectItems;

  // Built once, framed twice: a sheet on a phone, a docked column on a tablet.
  const library = (
    <LibraryContent
      onClose={() => setLibraryOpen(false)}
      libView={libView}
      onSelectView={onSelectView}
      search={search}
      onSearch={onSearch}
      projectStore={projectStore}
      editLog={editLog}
      versionStore={versionStore}
      dispatch={dispatch}
      onOpenShare={onOpenShare}
      onOpenSettings={onOpenSettings}
      onOpenAccount={onOpenAccount}
    />
  );
  const agent = (
    <AgentPanel
      onCollapse={() => setAgentOpen(false)}
      projectStore={projectStore}
      dispatch={dispatch}
      scheduler={scheduler}
      hasApiKey={hasApiKey}
      onOpenSettings={onOpenSettings}
    />
  );

  return (
    <div
      className="flex-1 min-h-0 flex flex-col relative overflow-hidden"
      data-device-tier={shape.tier}
      data-viewport-short={shape.short || undefined}
    >
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-line bg-rail">
        <BarButton label="Library" onClick={() => setLibraryOpen(!libraryOpen)} active={libraryOpen}>
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="w-5 h-5"
          >
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
          </svg>
        </BarButton>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <TransportBar
            projectStore={projectStore}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            isPlaying={isPlaying}
            started={started}
            compact
          />
        </div>
        {/* Undo / redo earn permanent slots on touch: there is no keyboard shortcut to
            fall back on, and fearless iteration is the point of the authored edit log. */}
        <BarButton label="Undo" onClick={() => editLog.undo()} disabled={!canUndo}>
          <UndoIcon />
        </BarButton>
        <BarButton label="Redo" onClick={() => editLog.redo()} disabled={!canRedo}>
          <UndoIcon flip />
        </BarButton>
        <Menu
          items={overflowItems}
          label="More controls"
          align="right"
          triggerClassName="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-card text-muted cursor-pointer"
          // A drawn glyph, not the default "⋮" character: a text kebab renders heavier
          // than the 20px stroked icons in the buttons either side of it, so at the same
          // box size it still read as the odd one out.
          trigger={
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="w-5 h-5">
              <circle cx="8" cy="3.5" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="8" cy="12.5" r="1.4" />
            </svg>
          }
        />
        <BarButton label="Agent" onClick={() => setAgentOpen(!agentOpen)} active={agentOpen} tint="agent">
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="w-5 h-5">
            <path d="M8 1.75l1.6 4.15 4.15 1.6-4.15 1.6L8 13.25l-1.6-4.15L2.25 7.5l4.15-1.6z" />
          </svg>
        </BarButton>
      </div>

      {/* The middle band: docked panels flank the workspace on a tablet; on a phone they
          are sheets over it (rendered below) and this is just the workspace. */}
      <div className="flex-1 min-h-0 flex">
        {docked && libraryOpen && (
          <DockedPanel side="left" label="Library">
            {library}
          </DockedPanel>
        )}
        {/* `relative` because the sheet is absolutely positioned against this column,
            not the shell: on a tablet it must not run under a docked library or agent,
            which own their full height. On a phone the column is the whole width anyway. */}
        <div className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <div
            className="min-h-0 flex flex-col"
            // The band above the sheet, so the timeline's own horizontal scroller stays on
            // screen instead of sitting under it. Committed detents only - during a drag
            // the sheet slides over this rather than resizing it every frame.
            style={{ height: selectedTrack ? `${(1 - detents[detent]) * 100}%` : "100%" }}
            // A click, not a pointerdown: scrolling the arrangement while parked must not
            // count as asking to edit, and a click is exactly the tap that is left over.
            onClick={onWorkspaceClick}
          >
            <ArrangementTimeline
              projectStore={projectStore}
              scheduler={scheduler}
              recorder={recorder}
              dispatch={dispatch}
              isPlaying={isPlaying}
              started={started}
              // One transport is pinned above the workspace, so the timeline must not render
              // a second copy, and its own options move into the shell's ⋮.
              showTransport={false}
              stickyHeaders={!isPhone}
              compact
              isActiveSurface={!sheetIsUp}
              // At Full the arrangement is a sliver, so make it the lane being edited.
              pinSelectedTrack={detent === "full"}
            />
          </div>
          {/* No sheet without a track: there is nothing to edit, and an empty sheet over
              the arrangement would just be a lid. Selecting a track brings it back at
              whatever detent it was left at. */}
          {selectedTrack && (
            <EditorSheet
              detent={detent}
              detents={detents}
              onDetentChange={setDetent}
              title={selectedTrack.name}
              subtitle={selectedTrack.kind === "audio" ? "audio" : selectedTrack.instrumentType}
              controls={
                <div
                  role="tablist"
                  aria-label="Editor surface"
                  className="ml-auto shrink-0 flex gap-0.5 p-0.5 rounded-lg border border-line bg-ground"
                >
                  {SURFACE_ITEMS.map((item) => {
                    const selected = item.surface === surface;
                    return (
                      <button
                        key={item.surface}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => {
                          setSurface(item.surface);
                          // Asking for a surface while parked means you want to see it.
                          if (detent === "peek") setDetent("half");
                        }}
                        className={`px-2.5 h-8 rounded-md font-mono text-[11px] uppercase tracking-wide cursor-pointer ${
                          selected ? "bg-you/20 text-you" : "text-muted"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              }
            >
              {surfacesFor(selectedTrack)[surface]}
            </EditorSheet>
          )}
        </div>
        {docked && agentOpen && (
          <DockedPanel side="right" label="Agent">
            {agent}
          </DockedPanel>
        )}
      </div>

      {!docked && (
        <>
          <Sheet
            open={libraryOpen}
            side="left"
            label="Library"
            onClose={() => setLibraryOpen(false)}
            widthClass="w-[86%] max-w-100"
          >
            {library}
          </Sheet>
          <Sheet open={agentOpen} side="right" label="Agent" onClose={() => setAgentOpen(false)}>
            {agent}
          </Sheet>
        </>
      )}
    </div>
  );
}
