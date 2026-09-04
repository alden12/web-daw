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
 * Because the arrangement and the editor are mounted at the same time, **both** publish to
 * the shell's ⋮ and it shows both, under headings. It used to hand ownership to whichever
 * was in front, which is a focus idea from a screen that has focus: at Half you are looking
 * at the timeline and the roll together, so following the front-most surface meant hiding
 * controls for a panel in plain view (`surfaceControls.ts` has the longer version).
 *
 * The library is reached from the ☰ at the left of the top bar, framed by device: a phone
 * gets a sheet over the app, a tablet **docks** it as a column beside the workspace, because
 * it has the width and covering what you are editing to pick an instrument for it is a phone
 * compromise rather than a virtue.
 *
 * **The agent lives inside that same column**, chosen from the rail at its head rather than
 * from a button of its own. It used to be a second sheet (phone) or a second docked column
 * (tablet) on the right, which on a phone meant two full-screen things fighting over one
 * screen, and on a tablet a workspace squeezed between two columns. Neither device has room
 * for two panels *and* something worth editing between them, so there is one panel and the
 * rail says what is in it.
 *
 * The top bar keeps only what you reach for mid-idea - record, play, undo, redo - and
 * everything else is behind ⋮, above the project's tempo, meter and metronome.
 *
 * Under the roll sit collapsible sections (MOBILE-6). The pads are the first, and they are
 * what makes a phone able to *play* rather than only arrange - and so what makes it able to
 * record, since they go out through the same `LiveNotes` seam a MIDI keyboard does.
 *
 * Deliberately not here yet: pinch-zoom and long-press menus (MOBILE-2), the clip rail as
 * the second section (it is still the Clips segment above), and the select-then-handles
 * editing model (MOBILE-7).
 */
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LibraryPanel } from "../LibraryPanel";
import { AgentPanel } from "../AgentPanel";
import { ArrangementTimeline } from "../ArrangementTimeline";
import { ClipRail } from "../ClipRail";
import { TransportBar } from "../TransportBar";
import { AccountAvatar } from "../AccountAvatar";
import { SettingsIcon } from "../ActivityRail";
import { Menu, type MenuItem } from "../Menu";
import { IconButton } from "../controls/IconButton";
import { iconButtonClass } from "../controls/iconButtonStyle";
import { Segmented } from "../controls/Segmented";
import { RAIL_ITEMS } from "../libraryViews";
import { TrackEditor } from "../workbench/TrackEditor";
import { DeviceRack } from "../workbench/DeviceRack";
import { TrackRecordButton } from "../workbench/TrackRecordButton";
import { NotePads } from "../pads/NotePads";
import { useProject } from "../../audio/project/useProject";
import { useEditLog } from "../../audio/commands/useEditLog";
import { useRecorder } from "../useRecorder";
import { usePersistentBoolean } from "../usePersistent";
import { useElementHeight } from "../useElementHeight";
import { useProjectSettingItems } from "../projectSettings";
import {
  TEMPO_BPM_RANGE,
  TIME_SIGNATURE_DENOMINATORS,
  TIME_SIGNATURE_NUMERATOR_RANGE,
} from "../../audio/project/schema";
import { readSurfaceControls, subscribeSurfaceControls } from "./surfaceControls";
import { detentsFor, type Detent } from "./detents";
import { EditorSheet, SHEET_HEADER_HEIGHT } from "./EditorSheet";
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

const SURFACE_ITEMS: SurfaceItem[] = [
  { surface: "edit", label: "Edit" },
  { surface: "clips", label: "Clips" },
  { surface: "devices", label: "Rack" },
];

/**
 * A top-bar icon button, sized for a finger rather than a cursor.
 *
 * Thin wrapper over `IconButton` so touch inherits the house rule (bare at rest, accent pill
 * when active) and the `lg` touch size in one place, rather than the bar keeping its own
 * palette. It exists only for the size default and `shrink-0` - a top bar that lets its
 * controls compress is a top bar that clips at 390px.
 */
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
  return (
    <IconButton
      label={label}
      tone={tint === "agent" ? "agent" : "you"}
      size="lg"
      active={active}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0"
    >
      {children}
    </IconButton>
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
 * The library's contents: the desktop's icon rail laid on its side across the top, the panel
 * below it, and settings plus the account pinned at the bottom, where the rail also keeps
 * them. Same `RAIL_ITEMS` data the desktop lays out vertically, so both platforms teach the
 * same vocabulary rather than one each.
 *
 * The agent is the first entry on that rail and shares the panel below it. See the file
 * header for why it is not a panel of its own.
 *
 * Wrapper-agnostic on purpose: a phone hosts this in a `Sheet` over the app, a tablet
 * docks it as a column beside the workspace. Only the frame differs.
 */
function LibraryContent({
  onClose,
  onPick,
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
  onOpenAgent,
  agentOpen,
  agent,
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
> & {
  onClose: () => void;
  /** Set only where this is a sheet: see `LibraryPanel`'s `onPick`. */
  onPick?: () => void;
  /** Toggle the agent panel. It is reached from here on every touch layout, not the top bar. */
  onOpenAgent: () => void;
  agentOpen: boolean;
  /** The agent panel itself, which shares this column rather than opening a second one. */
  agent: ReactNode;
}) {
  return (
    <>
      <div className="shrink-0 flex items-center gap-2 h-11 px-3 border-b border-line">
        <span className="text-[13px] font-semibold text-strong">Library</span>
        <IconButton label="Close library" size="lg" onClick={onClose} className="ml-auto text-lg leading-none">
          ✕
        </IconButton>
      </div>
      {/* The desktop rail, laid on its side. It used to be a scrolling strip of labelled
          pills, which is a lot of width spent on words you learn once - and it still did not
          fit, so the last views were off-screen behind a scroll nobody discovers. Icons fit
          all of them at once, and touch and desktop end up teaching the same vocabulary
          instead of two.

          The agent leads it. It is the one entry that is not a library view - it fills this
          panel with a conversation rather than switching what the panel lists - so it keeps
          its own voice colour, which separates it from the views without needing a rule
          drawn between them, and it reports pressed rather than current. */}
      <nav aria-label="Library views" className="shrink-0 flex items-stretch px-1 border-b border-line bg-frame">
        <button
          type="button"
          onClick={onOpenAgent}
          aria-pressed={agentOpen}
          aria-label="Agent"
          title="Agent"
          className={`relative flex-1 flex items-center justify-center h-11 cursor-pointer ${
            agentOpen ? "text-agent" : "text-agent/70 hover:text-agent"
          }`}
        >
          <span
            className={`absolute left-1.5 right-1.5 bottom-0 h-0.5 rounded-full bg-agent transition-opacity ${
              agentOpen ? "opacity-100" : "opacity-0"
            }`}
          />
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="w-4.5 h-4.5">
            <path d="M8 1.75l1.6 4.15 4.15 1.6-4.15 1.6L8 13.25l-1.6-4.15L2.25 7.5l4.15-1.6z" />
          </svg>
        </button>
        {RAIL_ITEMS.map((item) => {
          const selected = item.view === libView && !agentOpen;
          return (
            <button
              key={item.view}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelectView(item.view)}
              className={`relative flex-1 flex items-center justify-center h-11 cursor-pointer ${
                selected ? "text-strong" : "text-faint hover:text-ink"
              }`}
            >
              {/* The desktop rail marks the near edge; laid on its side that is the bottom. */}
              <span
                className={`absolute left-1.5 right-1.5 bottom-0 h-0.5 rounded-full bg-you transition-opacity ${
                  selected ? "opacity-100" : "opacity-0"
                }`}
              />
              {item.icon}
            </button>
          );
        })}
      </nav>
      {/* Both mounted, one shown. The agent shares this panel rather than opening a second
          one: on touch there is only ever room for one column of chrome beside the
          workspace, so a separate agent sheet was a second thing covering the same space
          the library was already covering.

          `hidden` rather than a conditional, because an agent run is interruptible and
          long-lived - unmounting the panel to look something up in the library would throw
          away the conversation and whatever is in flight. */}
      <div hidden={agentOpen} className="flex-1 min-h-0 flex flex-col">
        <LibraryPanel
          projectStore={projectStore}
          editLog={editLog}
          versionStore={versionStore}
          dispatch={dispatch}
          activeView={libView}
          search={search}
          onSearch={onSearch}
          onOpenShare={onOpenShare}
          onPick={onPick}
        />
      </div>
      <div hidden={!agentOpen} className="flex-1 min-h-0 flex flex-col">
        {agent}
      </div>
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-t border-line">
        <span className="w-10 shrink-0 empty:hidden">
          <AccountAvatar onClick={onOpenAccount} />
        </span>
        <IconButton label="Settings" size="lg" onClick={onOpenSettings} className="ml-auto">
          <SettingsIcon className="w-5 h-5" />
        </IconButton>
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
  liveNotes,
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

  // Every mounted workspace's own controls, in menu order (`surfaceControls.ts`).
  const surfaceGroups = useSyncExternalStore(subscribeSurfaceControls, readSurfaceControls, readSurfaceControls);

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
  /**
   * How much editor there is at the committed detent, for the pads to size themselves
   * against (MOBILE-6). **Derived from the workspace, not measured on the sheet**: the
   * workspace is a stable box, where a sheet mid-throw is held at full height and
   * translated, so measuring that would add a pad row during the gesture and take it back
   * on settle - the same trap the roll's re-centring fell into.
   */
  const workspaceRef = useRef<HTMLDivElement>(null);
  const workspaceHeight = useElementHeight(workspaceRef);
  const editorRoom = Math.max(0, workspaceHeight * detents[detent] - SHEET_HEADER_HEIGHT);

  // Surface -> the panel it hosts, as an object map so adding one is an entry here plus
  // one in SURFACE_ITEMS, and a missing case is a type error.
  const surfacesFor = (track: Track): Record<EditorSurface, ReactNode> => ({
    edit: (
      <div className="flex-1 min-h-0 flex flex-col">
        <TrackEditor
          track={track}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          projectStore={projectStore}
          compact
        />
      </div>
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

  // ⋮ - every mounted surface's controls, then the project's, each under a heading.
  //
  // The meter and the metronome are here because the compact transport drops them, which
  // also makes this their only writer (see TransportBar's `compact`).
  const projectSettingItems = useProjectSettingItems(project, dispatch);
  const meter = project.timeSignature;
  const setMeter = (patch: Partial<typeof meter>) =>
    dispatch({
      type: "setTimeSignature",
      numerator: patch.numerator ?? meter.numerator,
      denominator: patch.denominator ?? meter.denominator,
    });
  const projectItems: MenuItem[] = [
    // Fields, not lists of presets: tempo is 20-300 and beats-per-bar is 1-32, and the
    // curated subsets these used to be made the phone quietly less capable than the desktop
    // fields they stood in for - 174 was in the list, 173 was unreachable.
    {
      label: "Tempo",
      number: {
        value: project.tempoBpm,
        min: TEMPO_BPM_RANGE.min,
        max: TEMPO_BPM_RANGE.max,
        unit: "BPM",
        onChange: (bpm) => dispatch({ type: "setTempo", bpm }),
      },
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
          number: {
            value: meter.numerator,
            min: TIME_SIGNATURE_NUMERATOR_RANGE.min,
            max: TIME_SIGNATURE_NUMERATOR_RANGE.max,
            onChange: (numerator) => setMeter({ numerator }),
          },
        },
        {
          // Still a list: the denominators are an enum (powers of two), not a range.
          label: "Beat unit",
          submenu: TIME_SIGNATURE_DENOMINATORS.map((denominator) => ({
            label: String(denominator),
            checked: meter.denominator === denominator,
            onClick: () => setMeter({ denominator }),
          })),
        },
      ],
    },
    // Count-in and groove, which the timeline's toolbar menu used to carry on touch as well -
    // so they went missing the moment the editor came up, and read as arrangement settings
    // when they never were (MOBILE-11). Count-in belongs next to the record button most of all.
    ...projectSettingItems,
  ];
  /**
   * A getter, not an array: the shell is not re-rendered when a surface's own state changes
   * (the registry only notifies on mount/unmount, by design), so an array built here would
   * hold whatever was true at the shell's last unrelated render - a "Velocity lane" tick
   * still on after the lane was hidden, or a stale `disabled`. `Menu` calls this while it is
   * open, so the rows always reflect now.
   *
   * **Everything at once, whatever is in front.** Both the arrangement and the editor are
   * mounted the whole time here and at Half you are looking at both, so a menu that swapped
   * its contents to follow the front-most surface was hiding controls for a panel in plain
   * view - and, at any detent, hiding count-in and groove behind parking the sheet (MOBILE-11).
   * The headings are what makes one long list navigable, and they carry the answer to the
   * question the swap was trying to answer: which panel a row acts on.
   */
  const overflowItems = (): MenuItem[] => [
    ...surfaceGroups.flatMap((group) => [{ heading: group.title }, ...group.items()]),
    { heading: "Project" },
    ...projectItems,
  ];

  const agent = (
    <AgentPanel
      // Back to the library list: there is no separate panel to close any more.
      onCollapse={() => setAgentOpen(false)}
      projectStore={projectStore}
      dispatch={dispatch}
      scheduler={scheduler}
      hasApiKey={hasApiKey}
      onOpenSettings={onOpenSettings}
    />
  );

  // Built once, framed twice: a sheet on a phone, a docked column on a tablet.
  const library = (
    <LibraryContent
      onClose={() => setLibraryOpen(false)}
      // A sheet closes when you take something out of it, because on a phone it is covering
      // the track it just changed - swap the instrument behind it and nothing appears to
      // happen. A docked column is beside that track rather than over it, so it stays, and
      // picking several things in a row keeps working.
      onPick={docked ? undefined : () => setLibraryOpen(false)}
      agentOpen={agentOpen}
      agent={agent}
      onOpenAgent={() => setAgentOpen(!agentOpen)}
      libView={libView}
      // Picking a view means you want the library, so it stands the agent down. They share
      // one column now, and the rail is the one control that says which of them is in it.
      onSelectView={(view) => {
        setAgentOpen(false);
        onSelectView(view);
      }}
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
          triggerClassName={iconButtonClass({ size: "lg", className: "shrink-0" })}
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
        <div ref={workspaceRef} className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
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
              compact
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
                // Three short options, exactly one chosen: a segmented control, and now an
                // actual radiogroup rather than a `tablist` of buttons that each carried
                // their own corners - so it announces as one choice and takes arrow keys.
                <Segmented
                  label="Editor surface"
                  options={SURFACE_ITEMS.map((item) => ({ value: item.surface, label: item.label }))}
                  value={surface}
                  onChange={(next) => {
                    setSurface(next);
                    // Asking for a surface while parked means you want to see it.
                    if (detent === "peek") setDetent("half");
                  }}
                  className="ml-auto shrink-0 font-mono uppercase tracking-wide"
                />
              }
            >
              {surfacesFor(selectedTrack)[surface]}
              {/* The pads sit under whichever surface is showing, not inside one and not in
                  the switch beside them: they are how you play, and you want to play while
                  you tweak a device as much as while you edit notes. The surface above is
                  the flexible box, so opening the pads takes exactly their height from it
                  and nothing else moves (MOBILE-6). */}
              {selectedTrack.kind === "instrument" && (
                <NotePads
                  track={selectedTrack}
                  samples={project.samples}
                  notes={liveNotes}
                  // A tablet has the width for two octaves in a row; a phone does not, and
                  // below ~44px per pad the layout is wrong rather than merely tight.
                  octavesPerRow={shape.tier === "tablet" ? 2 : 1}
                  room={editorRoom}
                />
              )}
            </EditorSheet>
          )}
        </div>
      </div>

      {!docked && (
        <Sheet
          open={libraryOpen}
          side="left"
          label="Library"
          onClose={() => setLibraryOpen(false)}
          widthClass="w-[86%] max-w-100"
        >
          {library}
        </Sheet>
      )}
    </div>
  );
}
