/**
 * The touch shell's three places (MOBILE-19): **Explore**, **Studio** and **Projects**.
 *
 * Tabs came back after MOBILE-5 removed them, and the difference is what they switch between.
 * MOBILE-5's tabs split the *workspace* (arrange, edit, clips, devices), which the desktop never
 * does. These switch between *places* - your projects, the catalogue, the workspace - and the
 * Studio keeps the arrangement and editor sheet together exactly as before.
 *
 * Projects hosts the library views it inherits from the old ☰ panel (the project tree, its
 * history, search) until it gets its own design (MOBILE-19.3); Explore is the one Explore view
 * (COMM-1.9.1). `TAB_VIEWS` (`mobileTabViews.ts`) is that split.
 */
import type { ReactNode } from "react";
import { RAIL_ITEMS, type LibraryView } from "../libraryViews";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT } from "./safeArea";
import { isViewOf, MOBILE_TABS, type BrowseTab, type MobileTab } from "./mobileTabViews";

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-5.5 h-5.5"
  >
    {children}
  </svg>
);

const TAB_ITEMS: Record<MobileTab, { label: string; icon: ReactNode }> = {
  projects: {
    label: "Projects",
    icon: icon(
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />,
    ),
  },
  // Cards and tiles, not a compass: it says what is in there rather than that you may wander.
  explore: {
    label: "Explore",
    icon: icon(
      <>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
      </>,
    ),
  },
  studio: {
    label: "Studio",
    icon: icon(
      <>
        <path d="M2 4h12M2 8h12M2 12h12" />
        <rect x="3.5" y="2.5" width="5" height="3" rx=".8" fill="currentColor" stroke="none" />
        <rect x="6" y="6.5" width="6" height="3" rx=".8" fill="currentColor" stroke="none" />
        <rect x="2.5" y="10.5" width="4" height="3" rx=".8" fill="currentColor" stroke="none" />
      </>,
    ),
  },
};

/**
 * The bar along the bottom. It carries the home indicator's inset, which used to be the editor
 * sheet's to carry: the sheet no longer reaches the bottom edge, the bar does.
 */
export function TabBar({ tab, onSelect }: { tab: MobileTab; onSelect: (tab: MobileTab) => void }) {
  return (
    <nav
      aria-label="Places"
      className="shrink-0 flex border-t border-line bg-rail"
      style={{ paddingBottom: SAFE_BOTTOM, paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT }}
    >
      {MOBILE_TABS.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onSelect(item)}
          aria-current={item === tab ? "page" : undefined}
          className={`flex-1 h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] cursor-pointer ${
            item === tab ? "text-you" : "text-faint hover:text-ink"
          }`}
        >
          {TAB_ITEMS[item].icon}
          {TAB_ITEMS[item].label}
        </button>
      ))}
    </nav>
  );
}

/**
 * A tab's own views, as icons across the top - the desktop rail laid on its side, so both
 * platforms teach the same vocabulary. Same `RAIL_ITEMS` data the desktop lays out vertically.
 */
export function ViewRail({
  tab,
  current,
  onSelect,
}: {
  tab: BrowseTab;
  current: LibraryView;
  onSelect: (view: LibraryView) => void;
}) {
  const items = RAIL_ITEMS.filter((item) => isViewOf(tab, item.view));
  // A tab with one view has nothing to switch between.
  if (items.length < 2) return null;
  return (
    <nav
      aria-label={`${TAB_ITEMS[tab].label} views`}
      className="shrink-0 flex items-stretch px-1 border-b border-line bg-frame"
    >
      {items.map((item) => {
        const selected = item.view === current;
        return (
          <button
            key={item.view}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(item.view)}
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
  );
}
