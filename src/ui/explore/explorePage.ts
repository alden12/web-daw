/**
 * Which Explore page is open: home, or a category. Shared and persisted rather than the view's own
 * state, so it survives a reload or a trip to another tab, and so something outside Explore can
 * send you to a page - the Sampler's "reveal samples" link opens the Samples category.
 */
import { writePersistent } from "../persistentStore";
import { CATEGORY_ORDER, type ExploreCategory } from "./exploreItems";

export type ExplorePage = ExploreCategory | "home";

export const EXPLORE_PAGE_KEY = "corrente:explore-page";
export const EXPLORE_PAGES: readonly ExplorePage[] = ["home", ...CATEGORY_ORDER];

export const openExplorePage = (page: ExplorePage) => writePersistent(EXPLORE_PAGE_KEY, page);
