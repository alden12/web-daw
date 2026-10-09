/**
 * A row of tag chips that filter: tap one to narrow to it, tap it again to clear. One row that
 * scrolls sideways, on every device: wrapped, the vocabulary ate a third of the desktop panel.
 */
import { TAGS, type Tag } from "../../audio/tags";

export function TagChips({
  tags,
  selected,
  onSelect,
}: {
  tags: Tag[];
  selected: Tag | null;
  onSelect: (tag: Tag | null) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div role="group" aria-label="Filter by tag" className="flex gap-1.5 overflow-x-auto -mx-3 px-3 pb-1">
      {tags.map((tag) => {
        const on = tag === selected;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : tag)}
            className={`shrink-0 h-6 pointer-coarse:h-8 px-2 rounded-md border font-mono text-[11px] cursor-pointer ${
              on ? "border-you bg-you/15 text-you" : "border-line bg-ground text-muted hover:text-ink"
            }`}
          >
            #{TAGS[tag].label}
          </button>
        );
      })}
    </div>
  );
}
