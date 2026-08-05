/**
 * A small reusable kebab (⋮) context menu: an icon trigger that opens a popover of
 * actions, closing on an outside click, Escape, or scroll. Shared by track / group /
 * patch rows, the arrangement's add menu, and the recording settings menu so "more
 * actions" feels the same everywhere.
 *
 * **Every level is its own portaled, fixed-position popover.** The top-level popover always
 * was, so a row's overflow could not clip it; submenus were `absolute` inside their parent,
 * which cost three separate bugs that all read as different problems:
 *
 * - a flyout opened level with its own row ran off the bottom of a phone, taking most of a
 *   twelve-row list with it;
 * - a long menu had no way to scroll, because a scroll container clips what hangs out of it;
 * - and once one was given `overflow-y: auto`, a *third* level (Meter -> Beats per bar ->
 *   the numbers) rendered inside that scroller and was clipped to nothing - a submenu that
 *   answered a click with a scrollbar and no menu.
 *
 * Portaling every level fixes all three at once, because each one then places itself against
 * the viewport rather than against whatever box its parent happens to be. The geometry -
 * flip, shift, and the available height - is pure and lives in `menuPlacement.ts`.
 *
 * Only one (top-level) menu is open at a time, and within a popover only one row's submenu:
 * hovering a sibling closes the last, so flyouts cannot pile up.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { placeMenu, type Placed } from "./menuPlacement";

/** Marks every popover in the tree, so "did this click land inside the menu?" is one query. */
const POPOVER_ATTR = "data-menu-popover";

/** How long a flyout survives the pointer leaving its row, so the gap to it is crossable. */
const HOVER_GRACE_MS = 140;

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Radio-style selection: shows a check and an aria-checked state. */
  checked?: boolean;
  /** Nested items, opened as a flyout on hover/click. */
  submenu?: MenuItem[];
  /** A horizontal divider between groups of items (no label/action). */
  separator?: boolean;
}

// App-wide: only one (top-level) menu open at a time.
let closeActiveMenu: (() => void) | null = null;

const itemClass = (danger?: boolean) =>
  `flex items-center gap-2 w-full text-left whitespace-nowrap px-3 py-1.5 text-[12.5px] cursor-pointer hover:bg-you/10 disabled:opacity-40 disabled:cursor-not-allowed ${
    danger ? "text-claude" : "text-ink"
  }`;

/**
 * Hover is a mouse idea, so a touch pointer is not allowed to drive it. The browser fires
 * enter as a finger lands and leave as it lifts, which would open every submenu a thumb
 * dragged past, and - the bug this is here for - close the one that was just tapped open,
 * a moment after it appeared.
 */
const isHover = (event: ReactPointerEvent) => event.pointerType !== "touch";

/** True if the event landed inside any popover of any open menu. */
const insideMenu = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(`[${POPOVER_ATTR}]`));

/**
 * A portaled popover anchored to an element, measured and placed before paint so it never
 * flashes at the unplaced position. It reports `maxHeight`, so a list too long for the room
 * scrolls inside itself rather than off the edge.
 */
function Popover({
  anchorRef,
  strategy,
  side,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  strategy: "below" | "beside";
  side: "left" | "right";
  /** Hover handlers, so a flyout survives the pointer crossing the gap from its row. */
  onPointerEnter?: (event: ReactPointerEvent) => void;
  onPointerLeave?: (event: ReactPointerEvent) => void;
  children: (resolvedSide: "left" | "right") => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  /**
   * Measured once per opening, before paint, so it never flashes at the unplaced position.
   * One pass is enough because `scrollWidth`/`scrollHeight` are the *content's* size, which
   * the caps this pass applies do not change - measuring the laid-out box instead would
   * feed the cap back into the measurement and oscillate.
   */
  useLayoutEffect(() => {
    const popover = ref.current;
    const anchor = anchorRef.current;
    if (!popover || !anchor) return;
    const next = placeMenu(
      anchor.getBoundingClientRect(),
      { width: popover.scrollWidth, height: popover.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { strategy, side },
    );
    setPlaced((current) =>
      current && (Object.keys(next) as (keyof Placed)[]).every((key) => current[key] === next[key]) ? current : next,
    );
  }, [anchorRef, strategy, side]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-menu-popover=""
      // Stop pointerdown from bubbling to document: the popover is portaled to
      // document.body, so an ancestor popover's outside-click handler would otherwise
      // treat a click here as "outside" and unmount us before the click lands.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        position: "fixed",
        top: placed?.top ?? 0,
        left: placed?.left ?? 0,
        maxHeight: placed?.maxHeight,
        maxWidth: placed?.maxWidth,
        // Hidden until placed, rather than unmounted: it has to be in the document to be
        // measured, and one frame at the wrong place is exactly the flash to avoid.
        visibility: placed ? "visible" : "hidden",
      }}
      className="z-50 min-w-40 overflow-y-auto overscroll-contain py-1 rounded-lg border border-line bg-card shadow-lg"
    >
      {children(placed?.side ?? side)}
    </div>,
    document.body,
  );
}

/** One row in a popover: a leaf action, a radio selection, or a submenu parent. */
function Row({
  item,
  side,
  open,
  onOpen,
  onClose,
  onDismiss,
  reserveCheck,
}: {
  item: MenuItem;
  side: "left" | "right";
  /** Whether this row's submenu is showing - owned by the list, so siblings cannot both be. */
  open: boolean;
  onOpen: () => void;
  /** Close this row's submenu. */
  onClose: () => void;
  /** Close the whole menu (an action was taken). */
  onDismiss: () => void;
  /** Reserve the check gutter even on uncheckable rows, so a mixed menu's labels align. */
  reserveCheck: boolean;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(grace.current), []);

  if (item.separator) return <div role="separator" className="my-1 border-t border-line" />;
  // Show the check column for radio items; reserve an empty one on the menu's other
  // rows when any sibling is checkable, so plain/submenu rows still line up.
  const check =
    item.checked !== undefined || reserveCheck ? (
      <span className="w-3 shrink-0 text-you">{item.checked ? "✓" : ""}</span>
    ) : null;

  if (item.submenu) {
    // The flyout is portaled, so it is not a descendant of the row and leaving the row is
    // not leaving the menu. A short grace period bridges the gap between the two; entering
    // the flyout cancels it.
    const hold = () => clearTimeout(grace.current);
    const release = () => {
      clearTimeout(grace.current);
      grace.current = setTimeout(onClose, HOVER_GRACE_MS);
    };
    return (
      <>
        <button
          ref={rowRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={item.disabled}
          onPointerEnter={(event) => {
            if (!isHover(event)) return;
            hold();
            onOpen();
          }}
          onPointerLeave={(event) => {
            if (isHover(event)) release();
          }}
          // Not a toggle: on a mouse a real click is preceded by an enter, which would
          // otherwise close what the enter had just opened.
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className={itemClass(item.danger)}
        >
          {check}
          <span className="flex-1">{item.label}</span>
          <span className="text-muted text-[10px]">{side === "left" ? "◂" : "▸"}</span>
        </button>
        {open && (
          <Popover
            anchorRef={rowRef}
            strategy="beside"
            side={side}
            onPointerEnter={(event) => {
              if (isHover(event)) hold();
            }}
            onPointerLeave={(event) => {
              if (isHover(event)) release();
            }}
          >
            {(resolvedSide) => (
              <MenuList
                items={item.submenu!}
                // Grandchildren keep going the way this level actually went, rather than the
                // way it was asked to go, so a flyout that flipped does not double back.
                side={resolvedSide}
                onDismiss={onDismiss}
              />
            )}
          </Popover>
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
      aria-checked={item.checked}
      disabled={item.disabled}
      onClick={(event) => {
        event.stopPropagation();
        onDismiss();
        item.onClick?.();
      }}
      className={itemClass(item.danger)}
    >
      {check}
      <span className="flex-1">{item.label}</span>
    </button>
  );
}

/** The rows of one popover. Owns which single row has its submenu open. */
function MenuList({ items, side, onDismiss }: { items: MenuItem[]; side: "left" | "right"; onDismiss: () => void }) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const reserveCheck = items.some((item) => item.checked !== undefined);
  return (
    <>
      {items.map((item, index) => (
        <Row
          key={item.label ?? index}
          item={item}
          side={side}
          open={openRow === index}
          // Opening one closes the last, so hovering along a list cannot leave a trail of
          // flyouts behind it - the reason this state lives here and not on the row.
          onOpen={() => setOpenRow(index)}
          onClose={() => setOpenRow((current) => (current === index ? null : current))}
          onDismiss={onDismiss}
          reserveCheck={reserveCheck}
        />
      ))}
    </>
  );
}

export function Menu({
  items,
  label = "More actions",
  align = "right",
  triggerClassName = "shrink-0 px-1 text-[15px] leading-none text-muted hover:text-ink cursor-pointer",
  trigger = "⋮",
}: {
  /**
   * The rows, or a getter for them. Pass a **getter** when the items are derived from
   * state this component does not re-render for - notably the touch shell's ⋮, which
   * folds in the active surface's controls (`surfaceControls.ts`) and is not re-rendered
   * when that surface's own state changes. An array captured by the caller's last render
   * would show a stale `checked` tick or a stale `disabled`; a getter is read while the
   * menu is open, so it always reflects now.
   */
  items: MenuItem[] | (() => MenuItem[]);
  label?: string;
  align?: "left" | "right";
  triggerClassName?: string;
  /** The trigger glyph/content (defaults to the kebab ⋮). */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Right-aligned menus sit near the viewport's right edge, so their submenus fly left.
  const submenuSide = align === "right" ? "left" : "right";

  // Resolved on every render while open, not when the prop arrives: that is what lets a
  // getter reflect state the menu's owner did not re-render for.
  const rows = open && typeof items === "function" ? items() : Array.isArray(items) ? items : [];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    closeActiveMenu = close;
    const onDown = (event: PointerEvent) => {
      if (!insideMenu(event.target) && !triggerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // A fixed popover would drift on scroll/resize, so it closes - but a scroll *inside* the
    // menu is the menu being used (a list too long for the viewport scrolls), not the page
    // moving under it, and closing on that would make a long list unreachable.
    const onReflow = (event: Event) => {
      if (event.type === "scroll" && insideMenu(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
      if (closeActiveMenu === close) closeActiveMenu = null;
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (open) return setOpen(false);
          closeActiveMenu?.(); // enforce a single open menu
          setOpen(true);
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <Popover anchorRef={triggerRef} strategy="below" side={align}>
          {() => <MenuList items={rows} side={submenuSide} onDismiss={() => setOpen(false)} />}
        </Popover>
      )}
    </>
  );
}
