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
export type LibraryView = "search" | "project" | "explore" | "activity";

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
  // Cards and tiles, not a compass: it says what is in there rather than that you may wander.
  {
    view: "explore",
    label: "Explore",
    icon: svg(
      <>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
      </>,
    ),
  },
  { view: "activity", label: "Activity", icon: svg(<path d="M2 8h3l2-4 2 8 2-6 1.5 2H14" />) },
];
