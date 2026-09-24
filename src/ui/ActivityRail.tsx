/**
 * The activity rail (far left): a thin icon bar that switches the library panel
 * between one view at a time - Project / Instruments / Effects / Patches / Samples
 * / Activity. Clicking the active icon collapses the panel to just this rail
 * (mirroring the agent panel's collapse-to-rail); clicking any other icon selects
 * that view (expanding first if collapsed). The set of views is data (libraryViews.tsx),
 * shared with the touch shell's strip, so adding one is a single entry there.
 */
import { BrandMark } from "./BrandMark";
import { RAIL_ITEMS, type LibraryView } from "./libraryViews";

export type { LibraryView, RailItem } from "./libraryViews";

export function ActivityRail({
  active,
  collapsed,
  onSelect,
  onToggleCollapse,
  onOpenSettings,
}: {
  active: LibraryView;
  collapsed: boolean;
  onSelect: (view: LibraryView) => void;
  /** Fired when the *active* icon is clicked: collapse the panel to the rail (or reopen). */
  onToggleCollapse: () => void;
  /** Fired by the mark at the bottom: open the settings panel on its Account tab. */
  onOpenSettings: () => void;
}) {
  return (
    <nav
      aria-label="Library views"
      className="[grid-area:rail] h-full bg-frame border-r border-line flex flex-col items-center py-1.5"
    >
      {RAIL_ITEMS.map((item) => {
        const selected = item.view === active && !collapsed;
        return (
          <button
            key={item.view}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={selected ? "page" : undefined}
            onClick={() => (item.view === active ? onToggleCollapse() : onSelect(item.view))}
            className={`relative flex items-center justify-center w-full h-11 cursor-pointer ${
              selected ? "text-strong" : "text-faint hover:text-ink"
            }`}
          >
            {/* VSCode-style active marker on the near edge. */}
            <span
              className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-you transition-opacity ${
                selected ? "opacity-100" : "opacity-0"
              }`}
            />
            {item.icon}
          </button>
        );
      })}

      {/* Pinned below the views: the mark, and the rail's only control that is not one. It holds the
          slot the account avatar used to, and has taken that button's job - so unlike the views
          above it opens a panel rather than switching one. The settings gear that used to sit under
          it is gone, because account and settings are now one panel and two buttons onto the same
          thing is one too many. Unlike the avatar it renders in local/dev too, so the brand is
          there whether or not anyone is signed in. */}
      <div className="mt-auto flex flex-col items-center w-full">
        <button
          type="button"
          title="Account and settings"
          aria-label="Account and settings"
          onClick={onOpenSettings}
          className="flex items-center justify-center w-full h-11 cursor-pointer hover:[--brand-chip-edge:var(--brand-chip-edge-hover)]"
        >
          <BrandMark size={34} />
        </button>
      </div>
    </nav>
  );
}
