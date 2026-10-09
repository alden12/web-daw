/**
 * The tag filter: a row of chips, and "More tags" for the rest.
 *
 * The row is short and ranked (`rankTags`): what you have picked, then the few tags that best
 * split what is on screen. It cannot show the whole vocabulary, which only grows, so "More tags"
 * opens every tag the page has, grouped by role and character. One row that scrolls sideways, on
 * every device: wrapped, even a short list ate a third of the desktop panel.
 */
import { useState } from "react";
import { TAGS, type Tag } from "../../audio/tags";

const GROUPS = { role: "Role", character: "Character" } as const;

function Chip({ tag, on, onToggle }: { tag: Tag; on: boolean; onToggle: (tag: Tag) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onToggle(tag)}
      className={`shrink-0 h-6 pointer-coarse:h-8 px-2 rounded-md border font-mono text-[11px] cursor-pointer ${
        on ? "border-you bg-you/15 text-you" : "border-line bg-ground text-muted hover:text-ink"
      }`}
    >
      #{TAGS[tag].label}
    </button>
  );
}

export function TagChips({
  tags,
  all,
  picked,
  onToggle,
}: {
  /** The row, ranked: picked first, then the best splitters. */
  tags: Tag[];
  /** Every tag on the page, for "More tags". */
  all: Tag[];
  picked: readonly Tag[];
  onToggle: (tag: Tag) => void;
}) {
  const [more, setMore] = useState(false);
  const hidden = all.some((tag) => !tags.includes(tag));
  if (all.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Filter by tag" className="flex gap-1.5 overflow-x-auto -mx-3 px-3 pb-1">
        {tags.map((tag) => (
          <Chip key={tag} tag={tag} on={picked.includes(tag)} onToggle={onToggle} />
        ))}
        {(hidden || more) && (
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore(!more)}
            className="shrink-0 h-6 pointer-coarse:h-8 px-2 rounded-md text-[11.5px] text-you cursor-pointer whitespace-nowrap"
          >
            {more ? "Fewer tags" : "More tags"}
          </button>
        )}
      </div>
      {more && (
        <div role="group" aria-label="All tags" className="flex flex-col gap-2 p-2 rounded-md bg-stage">
          {Object.entries(GROUPS).map(([group, label]) => {
            const inGroup = all.filter((tag) => TAGS[tag].group === group);
            return (
              inGroup.length > 0 && (
                <div key={group} className="flex flex-col gap-1">
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {inGroup.map((tag) => (
                      <Chip key={tag} tag={tag} on={picked.includes(tag)} onToggle={onToggle} />
                    ))}
                  </div>
                </div>
              )
            );
          })}
        </div>
      )}
    </div>
  );
}
