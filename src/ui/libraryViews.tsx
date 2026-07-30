/**
 * The library view set, as data: one entry per view, carrying its label and glyph.
 *
 * Its own module because two layouts render it - the desktop `ActivityRail` as a
 * vertical icon column, and the touch shell's horizontal strip (MOBILE-1) - so adding
 * a view stays a single entry rather than a change in each shell. (It also has to be
 * separate from the components that consume it: a module mixing constant and component
 * exports breaks React Fast Refresh.)
 */
import type { ReactNode } from "react";

/** The one library view on show. Persisted, so it survives a reload. */
export type LibraryView = "search" | "project" | "instruments" | "effects" | "patches" | "samples" | "activity";

export interface RailItem {
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

export const RAIL_ITEMS: RailItem[] = [
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
    label: "Project",
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
