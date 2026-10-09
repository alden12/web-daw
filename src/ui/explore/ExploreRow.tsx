/**
 * One Explore item as a playlist row (COMM-1.9.1): number, artwork, name and tags, then its
 * actions. The whole left side is the primary tap (audition it on the selected track); the "+"
 * adds a new track, and the menu removes what is yours to remove. Play-a-demo, try-it and the
 * favourite heart join the row in COMM-1.9.2 / 1.9.3.
 */
import { Menu } from "../Menu";
import { ExploreThumb } from "./ExploreThumb";
import { CATEGORIES, type ExploreItem } from "./exploreItems";
import { PICK_HINT } from "./exploreActions";

export function ExploreRow({
  item,
  index,
  showKind,
  onPick,
  onAdd,
  onRemove,
}: {
  item: ExploreItem;
  /** The row's number in its list, from 1. */
  index: number;
  /** Mixed results say which category each row is from. */
  showKind?: boolean;
  onPick: () => void;
  onAdd?: () => void;
  onRemove?: { label: string; run: () => void };
}) {
  return (
    <div className="group flex items-center gap-1 pr-2 hover:bg-you/10" data-testid="explore-row">
      <button
        type="button"
        onClick={onPick}
        // Named for the device alone: the number, badge and tags are for the eye.
        aria-label={item.name}
        title={PICK_HINT[item.source.kind](item.name)}
        className="flex-1 min-w-0 flex items-center gap-2.5 pl-2 py-1.5 text-left cursor-pointer"
      >
        <span className="w-5 shrink-0 text-right font-mono text-[10px] text-faint tabular-nums">{index}</span>
        <ExploreThumb category={item.category} seed={item.name} portrait={item.portrait} size={40} />
        <span className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[13px] text-strong">{item.name}</span>
            {item.builtin && (
              <span className="hidden @[17rem]:inline shrink-0 px-1 rounded-sm border border-line font-mono text-[8.5px] tracking-wider text-faint">
                BUILT-IN
              </span>
            )}
          </span>
          <span className="truncate text-[11.5px] text-muted">
            {showKind ? `${CATEGORIES[item.category].kind} · ${item.meta}` : item.meta}
          </span>
          {item.tags.length > 0 && (
            <span className="truncate font-mono text-[10px] text-faint">
              {item.tags.map((tag) => `#${tag}`).join(" ")}
            </span>
          )}
        </span>
      </button>
      {onAdd && (
        <button
          type="button"
          title={`Add "${item.name}" as a new track`}
          aria-label={`Add "${item.name}" as a new track`}
          onClick={onAdd}
          className="shrink-0 w-7 h-7 rounded-md text-[18px] leading-none text-faint hover:text-strong hover:bg-you/10 cursor-pointer"
        >
          +
        </button>
      )}
      {onRemove && (
        <Menu
          label={`Actions: ${item.name}`}
          triggerClassName="shrink-0 w-7 h-7 text-[17px] leading-none text-faint hover:text-ink reveal-on-hover cursor-pointer"
          items={[{ label: onRemove.label, danger: true, onClick: onRemove.run }]}
        />
      )}
    </div>
  );
}
