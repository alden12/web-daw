/**
 * Explore (COMM-1.9.1): the library's one place for taking a device, replacing its separate
 * Instruments / Effects / Patches / Samples views. The same component fills the desktop panel and
 * the touch shell's Explore tab.
 *
 * Two pages. **Home** is a search box, tag chips and the category tiles; searching or picking a
 * tag swaps the tiles for matching rows from every category. A **category page** is a playlist:
 * header, count, tag filters, numbered rows. Shelves (Most favourited, Most added) join home
 * once there is a published catalogue to rank (COMM-1.9.4).
 */
import { useState } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { useProject } from "../../audio/project/useProject";
import type { Tag } from "../../audio/tags";
import { ExploreList } from "./ExploreList";
import { ExploreThumb } from "./ExploreThumb";
import { SampleImport } from "./SampleImport";
import { TagChips } from "./TagChips";
import {
  byName,
  CATEGORIES,
  CATEGORY_ORDER,
  type ExploreCategory,
  type ExploreItem,
  exploreItems,
  hasTags,
  matchesQuery,
  rankTags,
  tagsIn,
} from "./exploreItems";
import { useLibraryActions } from "./useLibraryActions";
import { useSavedPatches } from "./useSavedPatches";
import { EXPLORE_PAGE_KEY, EXPLORE_PAGES, type ExplorePage } from "./explorePage";
import { usePersistentString } from "../usePersistent";

function Hint({ children }: { children: string }) {
  return <p className="px-3.5 py-2 text-[11.5px] text-faint">{children}</p>;
}

/** "9 · all built-in", "13 · 11 built-in, 2 yours": where a category's contents come from. */
function countLine(items: ExploreItem[]) {
  const builtin = items.filter((item) => item.builtin).length;
  const yours = items.length - builtin;
  if (items.length === 0) return "Nothing here yet";
  if (yours === 0) return `${items.length} · all built-in`;
  if (builtin === 0) return `${items.length} · all yours`;
  return `${items.length} · ${builtin} built-in, ${yours} yours`;
}

export function ExploreView({
  projectStore,
  dispatch,
  onPicked,
}: {
  projectStore: ProjectStore;
  dispatch: Dispatch;
  onPicked: (act: () => void) => void;
}) {
  const project = useProject(projectStore);
  const savedPatches = useSavedPatches();
  const actions = useLibraryActions(projectStore, dispatch);
  const [page, setPage] = usePersistentString<ExplorePage>(EXPLORE_PAGE_KEY, "home", EXPLORE_PAGES);
  const category = page === "home" ? null : page;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Tag[]>([]);
  const toggleTag = (tag: Tag) =>
    setPicked((current) => (current.includes(tag) ? current.filter((each) => each !== tag) : [...current, tag]));
  const pickedLine = picked.map((tag) => `#${tag}`).join(" ");
  /** The chips for a page: ranked over what is on screen, with every tag in its pool behind "More". */
  const chips = (pool: ExploreItem[], shown: ExploreItem[]) => (
    <TagChips tags={rankTags(shown, picked)} all={tagsIn(pool)} picked={picked} onToggle={toggleTag} />
  );

  const items = exploreItems({ savedPatches, samples: project.samples });
  const inCategory = (key: ExploreCategory) => items.filter((item) => item.category === key);
  const list = (shown: ExploreItem[], showKind = false) => (
    <ExploreList items={shown} actions={actions} dispatch={dispatch} onPicked={onPicked} showKind={showKind} />
  );

  // Tag filters are per page: opening a category or going back home starts unfiltered.
  const openPage = (next: ExploreCategory | null) => {
    setPage(next ?? "home");
    setPicked([]);
  };

  if (category) {
    const all = inCategory(category).sort(byName);
    const shown = all.filter((item) => hasTags(item, picked));
    return (
      <div className="pb-2">
        <button
          type="button"
          onClick={() => openPage(null)}
          aria-label="Back to Explore"
          className="flex items-center gap-1 h-9 px-2.5 text-[12.5px] text-you cursor-pointer"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="w-4.5 h-4.5"
          >
            <path d="M10 3 5 8l5 5" />
          </svg>
          Explore
        </button>
        <div className="flex items-end gap-3 px-3.5">
          <ExploreThumb category={category} size={72} />
          <div className="min-w-0 pb-0.5">
            <div className="font-mono text-[9.5px] tracking-widest text-you">CATEGORY</div>
            <h2 className="text-[20px] font-semibold text-strong leading-tight truncate">
              {CATEGORIES[category].label}
            </h2>
            <div className="text-[11.5px] text-muted">{category === "favourites" ? "Coming soon" : countLine(all)}</div>
          </div>
        </div>
        {category === "favourites" ? (
          <Hint>
            Favourites arrive with the community catalogue: heart a device and it waits for you here, in any project.
          </Hint>
        ) : (
          <>
            <div className="px-3.5 pt-3 pb-1 flex flex-col gap-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">A to Z</div>
              {chips(all, shown)}
            </div>
            {category === "samples" && <SampleImport samples={project.samples} dispatch={dispatch} />}
            {shown.length > 0 ? (
              list(shown)
            ) : category === "samples" && picked.length === 0 ? (
              <Hint>Import a sample to play it with the Sampler.</Hint>
            ) : (
              <Hint>{`Nothing here is tagged ${pickedLine}.`}</Hint>
            )}
          </>
        )}
      </div>
    );
  }

  const filtering = query.trim() !== "" || picked.length > 0;
  const searched = items.filter((item) => matchesQuery(item, query));
  const results = searched
    .filter((item) => hasTags(item, picked))
    .sort(
      (left, right) =>
        CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) || byName(left, right),
    );

  return (
    <div className="pb-2">
      {/* A container, so the tiles fit the panel they are in rather than the window. */}
      <div className="@container p-3 flex flex-col gap-2.5">
        <label className="flex items-center gap-2 h-8 pointer-coarse:h-11 px-2.5 rounded-md border border-line bg-ground text-faint focus-within:border-you">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            className="w-4 h-4 shrink-0"
          >
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.2 10.2 13.5 13.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sounds, or #tags"
            aria-label="Search Explore"
            className="flex-1 min-w-0 bg-transparent text-ink text-[12.5px] pointer-coarse:text-[15px] placeholder:text-faint outline-none"
          />
        </label>
        {chips(searched, results)}
        {!filtering && (
          <div className="grid grid-cols-1 @[17rem]:grid-cols-2 gap-1.5 mt-0.5">
            {CATEGORY_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => openPage(key)}
                className="flex items-center gap-2 h-11 pointer-coarse:h-13 pr-2 rounded-md bg-stage overflow-hidden text-left cursor-pointer hover:bg-you/10"
              >
                <ExploreThumb category={key} size={44} />
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-strong">
                  {CATEGORIES[key].label}
                </span>
                {key !== "favourites" && (
                  <span className="font-mono text-[10px] text-faint">{inCategory(key).length}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {filtering &&
        (results.length > 0 ? (
          <>
            <div className="px-3.5 text-[11px] text-faint">
              {results.length} {results.length === 1 ? "match" : "matches"}
            </div>
            {list(results, true)}
          </>
        ) : (
          <Hint>{`Nothing matches${query.trim() ? ` “${query.trim()}”` : ""}${picked.length ? ` tagged ${pickedLine}` : ""}.`}</Hint>
        ))}
    </div>
  );
}
