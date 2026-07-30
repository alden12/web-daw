/**
 * The touch shell (MOBILE-1 round 2), used on phones and tablets and on any window too
 * narrow for the desktop grid. Same stores, same leaf panels - only the layout differs.
 *
 * The bottom tabs are **the desktop's four surfaces**, not navigation invented for
 * mobile: Arrangement, Edit, Clips, Devices. The desktop shows all four at once and a
 * phone can show one, so the tab bar switches between the same workspaces rather than
 * introducing new ones - the mental model transfers in both directions, and each tab
 * holds exactly one panel at full height (which is why nothing here needs a
 * side-by-side or squeezed-in special case).
 *
 * Above every tab except Arrangement sits the **lane strip**: the selected track's own
 * lane, on the same grid, zoom, scroll offset and playhead as the Arrangement tab. That
 * is what lets tapping a track merely *select* it - the selection stays on screen, so
 * selection no longer has to imply navigation.
 *
 * Library and agent are reached from the same ☰ / ✦ buttons at either end of the top bar,
 * but framed by device: a phone gets a sheet over the app, a tablet **docks** them as
 * columns beside the workspace, because it has the width and covering what you are
 * editing to pick an instrument for it is a phone compromise rather than a virtue.
 *
 * The top bar keeps only what you reach for mid-idea - record, play, undo, redo - and
 * everything else is behind ⋮, which carries the active surface's own controls (published
 * through `surfaceControls.ts`) above the project's tempo, meter and metronome.
 *
 * Deliberately not here yet (MOBILE-2): pinch-zoom, an explicit draw/select/erase tool
 * model, long-press menus, and the on-screen keyboard/pads.
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
import { LaneStrip } from "../arrangement/LaneStrip";
import { TrackEditor } from "../workbench/TrackEditor";
import { DeviceRack } from "../workbench/DeviceRack";
import { TrackRecordButton } from "../workbench/TrackRecordButton";
import { useProject } from "../../audio/project/useProject";
import { useEditLog } from "../../audio/commands/useEditLog";
import { useRecorder } from "../useRecorder";
import { usePersistentBoolean } from "../usePersistent";
import { TIME_SIGNATURE_DENOMINATORS, TIME_SIGNATURE_NUMERATOR_RANGE } from "../../audio/project/schema";
import { readSurfaceControls, subscribeSurfaceControls } from "./surfaceControls";
import { Sheet } from "./Sheet";
import type { ShellProps } from "./types";
import type { DeviceShape } from "./useDeviceShape";

type MobileTab = "arrange" | "edit" | "clips" | "devices";

interface TabItem {
  tab: MobileTab;
  label: string;
  icon: ReactNode;
}

// 24px line icons - the tab bar is the primary navigation and is touched, not pointed
// at, so these are deliberately larger than the desktop rail's 16px glyphs.
const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    {children}
  </svg>
);

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

const TAB_ITEMS: TabItem[] = [
  {
    tab: "arrange",
    label: "Arrangement",
    icon: svg(
      <>
        <rect x="1.75" y="3.25" width="7" height="3.5" rx="1" />
        <rect x="6.25" y="9.25" width="8" height="3.5" rx="1" />
      </>,
    ),
  },
  {
    tab: "edit",
    label: "Edit",
    // A beamed pair: two noteheads, two stems, one beam across the top.
    icon: svg(
      <>
        <circle cx="4" cy="12" r="2" />
        <circle cx="12.5" cy="10.5" r="2" />
        <path d="M6 12V3.25l8.5-1.75V10.5" />
      </>,
    ),
  },
  {
    tab: "clips",
    label: "Clips",
    icon: svg(
      <>
        <rect x="2" y="2.5" width="5" height="5" rx="1" />
        <rect x="9" y="2.5" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="4.5" rx="1" />
        <rect x="9" y="9" width="5" height="4.5" rx="1" />
      </>,
    ),
  },
  {
    tab: "devices",
    label: "Devices",
    icon: svg(
      <>
        <path d="M4.5 2v12M11.5 2v12" />
        <circle cx="4.5" cy="5.75" r="1.75" />
        <circle cx="11.5" cy="10.25" r="1.75" />
      </>,
    ),
  },
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
  const [tab, setTab] = useState<MobileTab>("arrange");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const project = useProject(projectStore);
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

  // Tab -> the panel it hosts. An object map keyed by tab, so adding a tab is one entry
  // here plus one in TAB_ITEMS (and a missing case is a type error).
  const views: Record<MobileTab, ReactNode> = {
    arrange: (
      <ArrangementTimeline
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        isPlaying={isPlaying}
        started={started}
        // One transport is pinned above every tab, so the timeline must not render a
        // second copy, and its own options move into the shell's ⋮.
        showTransport={false}
        stickyHeaders={!isPhone}
        compact
      />
    ),
    edit: selectedTrack ? (
      <TrackEditor
        track={selectedTrack}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        projectStore={projectStore}
        compact
      />
    ) : (
      <EmptyTab>No track selected. Pick one in Arrangement, or add an instrument from the library.</EmptyTab>
    ),
    clips: selectedTrack ? (
      <div className="flex-1 min-h-0 flex flex-col">
        <ClipRail
          projectStore={projectStore}
          scheduler={scheduler}
          trackId={selectedTrack.id}
          dispatch={dispatch}
          orientation="grid"
        />
        <div className="mt-auto shrink-0 p-3 border-t border-line">
          <TrackRecordButton trackId={selectedTrack.id} recorder={recorder} recording={recording} />
        </div>
      </div>
    ) : (
      <EmptyTab>No track selected.</EmptyTab>
    ),
    devices: selectedTrack ? (
      <div className="flex-1 min-h-0 flex flex-col">
        <DeviceRack
          track={selectedTrack}
          samples={project.samples}
          dispatch={dispatch}
          projectStore={projectStore}
          onRevealSamples={() => {
            onSelectView("samples");
            setLibraryOpen(true);
          }}
        />
      </div>
    ) : (
      <EmptyTab>No track selected.</EmptyTab>
    ),
  };

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
  const overflowItems: MenuItem[] = surfaceControls
    ? [...surfaceControls(), { separator: true }, ...projectItems]
    : projectItems;

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
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* The selected track's lane, on every tab but Arrangement (which is the lanes). */}
          {tab !== "arrange" && selectedTrack && (
            <LaneStrip
              track={selectedTrack}
              projectStore={projectStore}
              scheduler={scheduler}
              recorder={recorder}
              dispatch={dispatch}
            />
          )}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{views[tab]}</div>
        </div>
        {docked && agentOpen && (
          <DockedPanel side="right" label="Agent">
            {agent}
          </DockedPanel>
        )}
      </div>

      <nav
        aria-label="Views"
        role="tablist"
        className="shrink-0 flex items-stretch border-t border-line bg-rail"
        // Keep the tabs clear of the home indicator / gesture bar on iOS.
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TAB_ITEMS.map((item) => {
          const selected = item.tab === tab;
          return (
            <button
              key={item.tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={item.label}
              onClick={() => setTab(item.tab)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 h-14 cursor-pointer ${
                selected ? "text-you" : "text-muted"
              }`}
            >
              {selected && <span className="absolute top-0 left-3 right-3 h-0.5 bg-you rounded-full" />}
              {item.icon}
              <span className="text-[10px] leading-none">{item.label}</span>
            </button>
          );
        })}
      </nav>

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

function EmptyTab({ children }: { children: ReactNode }) {
  return <div className="flex-1 grid place-items-center p-6 text-center text-sm text-muted">{children}</div>;
}
