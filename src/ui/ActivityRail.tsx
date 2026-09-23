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

/**
 * The settings cog. It no longer appears in this rail - the mark at the bottom opens the panel now -
 * but the touch shell still shows one, and this is where it has always lived. Its own component
 * because the toothed ring is drawn on a 24-unit grid, unlike the 16-grid view icons.
 */
export function SettingsIcon({ className = "w-4.5 h-4.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function ActivityRail({
  active,
  collapsed,
  onSelect,
  onToggleCollapse,
  onOpenAccount,
}: {
  active: LibraryView;
  collapsed: boolean;
  onSelect: (view: LibraryView) => void;
  /** Fired when the *active* icon is clicked: collapse the panel to the rail (or reopen). */
  onToggleCollapse: () => void;
  /** Fired by the mark at the bottom: open the settings panel on its Account tab. */
  onOpenAccount: () => void;
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
          onClick={onOpenAccount}
          className="flex items-center justify-center w-full h-11 cursor-pointer hover:[--brand-chip-edge:var(--brand-chip-edge-hover)]"
        >
          <BrandMark size={34} />
        </button>
      </div>
    </nav>
  );
}
