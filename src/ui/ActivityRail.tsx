/**
 * The activity rail (far left): a thin icon bar that switches the library panel
 * between one view at a time - Search / Project / Explore / Activity. Clicking the active icon collapses the panel to just this rail
 * (mirroring the agent panel's collapse-to-rail); clicking any other icon selects
 * that view (expanding first if collapsed). The set of views is data (libraryViews.tsx),
 * shared with the touch shell's strip, so adding one is a single entry there.
 */
import { AccountAvatar } from "./AccountAvatar";
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

      {/* Pinned below the views: you, as your initials (`AccountAvatar`, the same chip as the touch
          top bar), and the rail's only control that opens a panel rather than switching a view.
          Account and settings are one panel, so this is the one button onto both. It renders in
          local/dev too, from your handle, so it is there whether or not anyone is signed in. */}
      <div className="mt-auto flex flex-col items-center w-full">
        <button
          type="button"
          title="Account and settings"
          aria-label="Account and settings"
          onClick={onOpenSettings}
          className="flex items-center justify-center w-full h-11 cursor-pointer"
        >
          <AccountAvatar size={30} />
        </button>
      </div>
    </nav>
  );
}
