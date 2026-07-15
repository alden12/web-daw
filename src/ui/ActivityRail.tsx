/**
 * The activity rail (far left): a thin icon bar that switches the library panel
 * between one view at a time - Project / Instruments / Effects / Patches / Samples
 * / Activity. Clicking the active icon collapses the panel to just this rail
 * (mirroring the agent panel's collapse-to-rail); clicking any other icon selects
 * that view (expanding first if collapsed). The set of views is data, so adding one
 * is a single entry here.
 */
import type { ReactNode } from "react";

/** The one library view shown beside the rail. Persisted, so it survives a reload. */
export type LibraryView = "search" | "project" | "instruments" | "effects" | "patches" | "samples" | "activity";

interface RailItem {
  view: LibraryView;
  label: string;
  icon: ReactNode;
}

// 16px line icons (stroke = currentColor), matching the app's minimal glyph style.
const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4.5 h-4.5"
  >
    {children}
  </svg>
);

const RAIL_ITEMS: RailItem[] = [
  {
    view: "search",
    label: "Search",
    icon: svg(
      <>
        <circle cx="7" cy="7" r="4.25" />
        <path d="M10.2 10.2 13.5 13.5" />
      </>,
    ),
  },
  {
    view: "project",
    label: "Projects",
    icon: svg(
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />,
    ),
  },
  {
    view: "instruments",
    label: "Instruments",
    icon: svg(
      <>
        <rect x="2.5" y="4" width="11" height="8" rx="1" />
        <path d="M6 4v4M8 4v4M10 4v4" />
      </>,
    ),
  },
  {
    view: "effects",
    label: "Effects",
    icon: svg(
      <>
        <path d="M3 5h10M3 8h10M3 11h10" />
        <circle cx="6" cy="5" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="5" cy="11" r="1.4" fill="currentColor" stroke="none" />
      </>,
    ),
  },
  { view: "patches", label: "Patches", icon: svg(<path d="M4 2.5h8v11l-4-2.5-4 2.5z" />) },
  {
    view: "samples",
    label: "Samples",
    icon: svg(<path d="M2 8h1.5M4.5 5v6M6.5 3v10M8.5 5.5v5M10.5 4v8M12.5 6.5v3M14 8h.5" />),
  },
  { view: "activity", label: "Activity", icon: svg(<path d="M2 8h3l2-4 2 8 2-6 1.5 2H14" />) },
];

export function ActivityRail({
  active,
  collapsed,
  onSelect,
  onToggleCollapse,
  onOpenSettings,
}: {
  active: LibraryView;
  collapsed: boolean;
  onSelect: (view: LibraryView) => void;
  /** Fired when the *active* icon is clicked: collapse the panel to the rail (or reopen). */
  onToggleCollapse: () => void;
  /** Fired by the gear at the bottom: open the agent settings dialog. */
  onOpenSettings: () => void;
}) {
  return (
    <nav
      aria-label="Library views"
      className="[grid-area:rail] h-full bg-rail border-r border-line flex flex-col items-center py-1.5"
    >
      {RAIL_ITEMS.map((item) => {
        const selected = item.view === active && !collapsed;
        return (
          <button
            key={item.view}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={selected ? "page" : undefined}
            onClick={() => (item.view === active ? onToggleCollapse() : onSelect(item.view))}
            className={`relative flex items-center justify-center w-full h-11 cursor-pointer ${
              selected ? "text-bright" : "text-faint hover:text-ink"
            }`}
          >
            {/* VSCode-style active marker on the near edge. */}
            <span
              className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-you transition-opacity ${
                selected ? "opacity-100" : "opacity-0"
              }`}
            />
            {item.icon}
          </button>
        );
      })}

      {/* Agent settings (BYOK key + provider) - pinned to the bottom, separate from the
          views. A cog (24-unit grid for the toothed ring), not the 16-grid view icons. */}
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="mt-auto flex items-center justify-center w-full h-11 cursor-pointer text-faint hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4.5 h-4.5"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </nav>
  );
}
