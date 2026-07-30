/**
 * The touch shell (MOBILE-1), used on phones and tablets and on any window too narrow
 * for the desktop grid. Same stores, same leaf panels - only the layout differs:
 *
 * - a **persistent transport** pinned to the top, so play / stop / tempo are always
 *   reachable no matter which view is open;
 * - **one view at a time** in the middle, because the four-region grid needs width
 *   that a phone does not have;
 * - a **bottom tab bar** in the thumb zone (Arrange / Edit / Mix / Library / Agent).
 *
 * The tab set is data, like the activity rail it mirrors, and each tab re-hosts an
 * existing panel unchanged. Panels self-assign a `[grid-area:...]`, which is inert
 * here because this shell is flex, not grid - so they need no mobile-specific props.
 *
 * Deliberately not in this slice (MOBILE-2 and on): pinch-zoom, an explicit
 * draw/select/erase tool model, slide-up sheets, and the on-screen keyboard/pads.
 */
import { useState, type ReactNode } from "react";
import { LibraryPanel } from "../LibraryPanel";
import { CenterWorkbench } from "../CenterWorkbench";
import { AgentPanel } from "../AgentPanel";
import { ArrangementTimeline } from "../ArrangementTimeline";
import { ProjectView } from "../ProjectView";
import { TransportBar } from "../TransportBar";
import { AccountAvatar } from "../AccountAvatar";
import { SettingsIcon } from "../ActivityRail";
import { RAIL_ITEMS } from "../libraryViews";
import type { ShellProps } from "./types";
import type { DeviceShape } from "./useDeviceShape";

type MobileTab = "arrange" | "edit" | "mix" | "library" | "agent";

interface TabItem {
  tab: MobileTab;
  label: string;
  icon: ReactNode;
}

// 24px line icons - the tab bar is the primary navigation and is touched, not
// pointed at, so these are deliberately larger than the desktop rail's 16px glyphs.
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

const TAB_ITEMS: TabItem[] = [
  {
    tab: "arrange",
    label: "Arrange",
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
    tab: "mix",
    label: "Mix",
    icon: svg(
      <>
        <path d="M4.5 2v12M11.5 2v12" />
        <circle cx="4.5" cy="5.75" r="1.75" />
        <circle cx="11.5" cy="10.25" r="1.75" />
      </>,
    ),
  },
  {
    tab: "library",
    label: "Library",
    icon: svg(
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />,
    ),
  },
  {
    tab: "agent",
    label: "Agent",
    icon: svg(<path d="M8 1.75l1.6 4.15 4.15 1.6-4.15 1.6L8 13.25l-1.6-4.15L2.25 7.5l4.15-1.6z" />),
  },
];

/**
 * The library view switcher, as a horizontal strip above the panel. The desktop rail
 * is a vertical column of the same items; on touch it becomes a scrollable row so the
 * panel below keeps the full height. Settings and the account sit at its end, where
 * the rail keeps them pinned at its bottom.
 */
function LibraryViewStrip({
  active,
  onSelect,
  onOpenSettings,
  onOpenAccount,
}: {
  active: ShellProps["libView"];
  onSelect: ShellProps["onSelectView"];
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}) {
  return (
    <nav
      aria-label="Library views"
      className="shrink-0 flex items-center gap-1 px-1.5 py-1 border-b border-line bg-rail overflow-x-auto"
    >
      {RAIL_ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          onClick={() => onSelect(item.view)}
          aria-label={item.label}
          aria-current={item.view === active}
          className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-md cursor-pointer ${
            item.view === active ? "text-bright bg-panel" : "text-muted"
          }`}
        >
          {item.icon}
        </button>
      ))}
      <span className="ml-auto shrink-0 flex items-center gap-1 pl-1">
        {/* Renders nothing when auth is off or nobody is signed in, same as in the rail. */}
        <span className="w-10 shrink-0 empty:hidden">
          <AccountAvatar onClick={onOpenAccount} />
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className="flex items-center justify-center w-10 h-10 rounded-md text-muted cursor-pointer"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </span>
    </nav>
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
  mcpStatus,
  syncStatus,
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
  // Two independent concessions, because the two scarce axes are independent.
  // Narrow (phone portrait): no pinned header column, no left clip rail - horizontal
  // space is what's missing. A tablet, and a phone in landscape at ~844px, has plenty.
  // Short (phone landscape): the editor and the device rack go side by side, because
  // stacked they are each too shallow to read.
  const { tier, short } = shape;
  const isPhone = tier === "phone";

  // Tab -> the panel it hosts. An object map keyed by tab, so adding a tab is one
  // entry here plus one in TAB_ITEMS (and a missing case is a type error).
  const views: Record<MobileTab, ReactNode> = {
    arrange: (
      <ArrangementTimeline
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        isPlaying={isPlaying}
        started={started}
        // The transport is pinned above every tab here, so the timeline must not
        // render a second copy of it in its own toolbar.
        showTransport={false}
        stickyHeaders={!isPhone}
        // No side-by-side workbench here, so picking a track has to change tabs to show it.
        onEditTrack={() => setTab("edit")}
      />
    ),
    edit: (
      <CenterWorkbench
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        selectedTrack={selectedTrack}
        onRevealSamples={() => {
          onSelectView("samples");
          setTab("library");
        }}
        mcpStatus={mcpStatus}
        syncStatus={syncStatus}
        // There is no side-by-side agent pane to expand; its chevron jumps to the tab.
        agentCollapsed
        onExpandAgent={() => setTab("agent")}
        compact={isPhone}
        sideBySide={short}
      />
    ),
    mix: (
      <div className="flex-1 min-h-0 overflow-y-auto bg-panel">
        <ProjectView projectStore={projectStore} dispatch={dispatch} />
      </div>
    ),
    library: (
      <>
        <LibraryViewStrip
          active={libView}
          onSelect={onSelectView}
          onOpenSettings={onOpenSettings}
          onOpenAccount={onOpenAccount}
        />
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
      </>
    ),
    agent: (
      <AgentPanel
        onCollapse={() => setTab("arrange")}
        projectStore={projectStore}
        dispatch={dispatch}
        scheduler={scheduler}
        hasApiKey={hasApiKey}
        onOpenSettings={onOpenSettings}
      />
    ),
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-device-tier={tier} data-viewport-short={short || undefined}>
      <div className="shrink-0 flex items-center gap-3 px-2.5 py-1.5 border-b border-line bg-rail overflow-x-auto">
        <TransportBar
          projectStore={projectStore}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          isPlaying={isPlaying}
          started={started}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{views[tab]}</div>

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
                selected ? "text-bright" : "text-muted"
              }`}
            >
              {selected && <span className="absolute top-0 left-3 right-3 h-0.5 bg-you rounded-full" />}
              {item.icon}
              <span className="text-[10px] leading-none">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
