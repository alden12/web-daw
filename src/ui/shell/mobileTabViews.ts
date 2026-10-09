/**
 * The touch shell's tabs and the library views each hosts (MOBILE-19), as data. Components are in
 * `MobileTabs.tsx`; this is separate so that file exports components only.
 */
import type { LibraryView } from "../libraryViews";

export type MobileTab = "projects" | "explore" | "studio";
export const MOBILE_TABS: readonly MobileTab[] = ["projects", "explore", "studio"];

/** The library views each non-Studio tab hosts. The first is where the tab opens. */
export const TAB_VIEWS = {
  projects: ["project", "activity"],
  explore: ["instruments", "effects", "patches", "samples", "search"],
} as const satisfies Record<Exclude<MobileTab, "studio">, readonly LibraryView[]>;

export type BrowseTab = keyof typeof TAB_VIEWS;

export const isViewOf = (tab: BrowseTab, view: LibraryView) =>
  (TAB_VIEWS[tab] as readonly LibraryView[]).includes(view);
