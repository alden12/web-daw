/**
 * A numbered list of Explore items, wired to what taking each one does. Shared by a category
 * page, the home page's results and the library's search view, so a row behaves the same
 * wherever it turns up.
 */
import type { Dispatch } from "../../audio/commands/types";
import { removePatch } from "../../audio/patches/library";
import { ExploreRow } from "./ExploreRow";
import { addTrackFor, pickItem } from "./exploreActions";
import type { ExploreItem, ItemSource } from "./exploreItems";
import type { LibraryActions } from "./useLibraryActions";

/**
 * Library management, for what is yours to manage: a saved patch, a project sample. Not a pick,
 * so it does not close anything. Factory presets and the catalogs have no entry.
 */
const REMOVE: Partial<
  Record<ItemSource["kind"], (source: ItemSource, dispatch: Dispatch) => { label: string; run: () => void } | undefined>
> = {
  patch: (source) =>
    source.kind === "patch" && !source.patch.builtin
      ? { label: "Delete patch", run: () => removePatch(source.patch.id) }
      : undefined,
  sample: (source, dispatch) =>
    source.kind === "sample"
      ? { label: "Remove from library", run: () => dispatch({ type: "removeSample", id: source.id }) }
      : undefined,
};

export function ExploreList({
  items,
  actions,
  dispatch,
  onPicked,
  showKind,
}: {
  items: ExploreItem[];
  actions: LibraryActions;
  dispatch: Dispatch;
  /** Wraps every pick, so the host can get out of the way after it (see `LibraryPanel`). */
  onPicked: (act: () => void) => void;
  showKind?: boolean;
}) {
  return (
    <div className="@container py-1">
      {items.map((item, index) => {
        const add = addTrackFor(item.source, actions);
        return (
          <ExploreRow
            key={item.key}
            item={item}
            index={index + 1}
            showKind={showKind}
            onPick={() => onPicked(() => pickItem(item.source, actions))}
            onAdd={add && (() => onPicked(add))}
            onRemove={REMOVE[item.source.kind]?.(item.source, dispatch)}
          />
        );
      })}
    </div>
  );
}
