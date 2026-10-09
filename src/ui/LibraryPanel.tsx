/**
 * The library panel (beside the activity rail): shows exactly one view at a time -
 * the view chosen on the rail. A search box sits above the view title; typing shows
 * a grouped results view across tracks + every device. The title bar and its main
 * menu live in `LibraryHeader`. Explore, Project and Activity delegate to their own
 * components; Explore reads the same catalogs the engine and MCP use.
 */
import type { ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { useProject } from "../audio/project/useProject";
import type { Dispatch } from "../audio/commands/types";
import type { LibraryView } from "./ActivityRail";
import { ActivityView } from "./ActivityView";
import { ProjectView } from "./ProjectView";
import { LibraryHeader } from "./LibraryHeader";
import { ExploreView } from "./explore/ExploreView";
import { ExploreList } from "./explore/ExploreList";
import { byName, CATEGORY_ORDER, exploreItems, matchesQuery } from "./explore/exploreItems";
import { useLibraryActions } from "./explore/useLibraryActions";
import { useSavedPatches } from "./explore/useSavedPatches";

/** A results section header (grouped search results). */
function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] uppercase tracking-wide text-faint">{children}</div>;
}

/** An empty-view hint (no matches, or nothing saved yet). */
function Hint({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-2 text-[11.5px] text-faint">{children}</p>;
}

export function LibraryPanel({
  projectStore,
  editLog,
  versionStore,
  dispatch,
  activeView,
  search,
  onSearch,
  onOpenShare,
  onPick,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  dispatch: Dispatch;
  activeView: LibraryView;
  search: string;
  onSearch: (query: string) => void;
  onOpenShare: (projectId: string, projectName: string) => void;
  /** Something was taken from the library. Set where the panel is covering what it changes. */
  onPick?: () => void;
}) {
  const project = useProject(projectStore);
  const savedPatches = useSavedPatches();
  const actions = useLibraryActions(projectStore, dispatch);

  /**
   * Picking something out of the library: do it, then get out of the way.
   *
   * Clearing the query returns from the search results to the view that was open before
   * searching (or stays on Search if it was opened directly - see AppShell), and is a no-op
   * anywhere else, since a query is what puts you in the results view in the first place.
   *
   * `onPick` is the phone's half: the library covers the whole screen there, so swapping an
   * instrument or adding a device changes something you cannot see, and the tab has to
   * change for anything to have visibly happened. Library *management* - deleting a patch,
   * removing a sample - is not a pick and stays put.
   */
  const picked = (act: () => void) => {
    act();
    onSearch("");
    onPick?.();
  };

  const query = search.trim().toLowerCase();
  const matchedTracks = project.tracks.filter((track) => track.name.toLowerCase().includes(query));
  const matchedItems = exploreItems({ savedPatches, samples: project.samples })
    .filter((item) => matchesQuery(item, query))
    .sort(
      (left, right) =>
        CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) || byName(left, right),
    );

  // One renderer per view (data-driven, so adding a view is a single entry).
  const views: Record<LibraryView, () => ReactNode> = {
    search: () =>
      query === "" ? (
        <Hint>Type above to search tracks, instruments, effects, patches, and samples.</Hint>
      ) : matchedTracks.length + matchedItems.length === 0 ? (
        <Hint>No matches for “{search.trim()}”.</Hint>
      ) : (
        <div className="pb-2">
          {matchedTracks.length > 0 && (
            <>
              <SectionLabel>Tracks</SectionLabel>
              {matchedTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => picked(() => projectStore.selectTrack(track.id))}
                  title={`Select "${track.name}"`}
                  className="flex items-center gap-2.5 w-full text-left px-3.5 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10"
                >
                  <span
                    aria-hidden="true"
                    className={`w-1.75 h-1.75 shrink-0 ${track.kind === "audio" ? "rounded-full" : "rounded-sm"} bg-line`}
                  />
                  <span className="truncate">{track.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">
                    {track.kind === "audio"
                      ? "audio"
                      : track.instrumentType === EMPTY_INSTRUMENT
                        ? "empty"
                        : track.instrumentType}
                  </span>
                </button>
              ))}
            </>
          )}
          {matchedItems.length > 0 && (
            <>
              <SectionLabel>Devices</SectionLabel>
              <ExploreList items={matchedItems} actions={actions} dispatch={dispatch} onPicked={picked} showKind />
            </>
          )}
        </div>
      ),
    project: () => <ProjectView projectStore={projectStore} dispatch={dispatch} />,
    activity: () => <ActivityView editLog={editLog} versionStore={versionStore} />,
    explore: () => <ExploreView projectStore={projectStore} dispatch={dispatch} onPicked={picked} />,
  };

  return (
    <div className="[grid-area:library] min-w-0 bg-rail border-r border-line flex flex-col flex-1 min-h-0">
      {/* Search sits above the view title; typing jumps to the Search results view. Explore
          searches its own contents, so it has its own box and this one stands down. */}
      <div className={`shrink-0 p-2 border-b border-line ${activeView === "explore" ? "hidden" : ""}`}>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search library…"
          aria-label="Search the library"
          className="w-full px-2.5 py-1.5 border border-line rounded-md bg-ground text-ink placeholder:text-faint text-xs focus:outline-none focus:border-you"
        />
      </div>
      <LibraryHeader
        activeView={activeView}
        projectStore={projectStore}
        editLog={editLog}
        versionStore={versionStore}
        onOpenShare={onOpenShare}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">{views[activeView]()}</div>
    </div>
  );
}
