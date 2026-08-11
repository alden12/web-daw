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
 *
 * A row is a leaf action, a radio selection, a submenu parent, a separator, a **group
 * heading**, or a **number field** - all of them `MenuItem` data, so a caller composes a menu
 * rather than rendering one. The last two exist for the touch shell's ⋮, which is several
 * surfaces' toolbars in one list (headings say which), and which has no toolbar to put a
 * tempo field on (so the field comes here).
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

/**
 * A number a list of presets cannot honestly cover. Tempo is 20-300 and beats-per-bar is
 * 1-32; a submenu of either is a scroll rather than a control, and picking "the ones worth
 * an entry" makes the menu quietly less capable than the field on desktop.
 */
export interface MenuNumber {
  value: number;
  min: number;
  max: number;
  /** What the nudge buttons move by, and the field's own step. Defaults to 1. */
  step?: number;
  /** A short suffix after the field (BPM). */
  unit?: string;
  onChange: (value: number) => void;
}

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
  /**
   * A non-interactive group title. Menus that gather several sources into one list (the touch
   * shell's ⋮) need to say where a row came from - two surfaces both offering "Snap to grid"
   * is otherwise a coin toss.
   */
  heading?: string;
  /** A number field with nudge buttons, in place of a submenu of preset values. */
  number?: MenuNumber;
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
  onDetached,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  strategy: "below" | "beside";
  side: "left" | "right";
  /** The anchor has left the viewport, so there is nothing left to hang off. */
  onDetached: () => void;
  /** Hover handlers, so a flyout survives the pointer crossing the gap from its row. */
  onPointerEnter?: (event: ReactPointerEvent) => void;
  onPointerLeave?: (event: ReactPointerEvent) => void;
  children: (resolvedSide: "left" | "right") => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  // Read by a listener that outlives the render it was set up in, so the callback is held in
  // a ref rather than in the effect's dependencies - re-subscribing on every render would
  // tear the listeners down and rebuild them mid-scroll.
  const onDetachedRef = useRef(onDetached);
  useEffect(() => {
    onDetachedRef.current = onDetached;
  });

  /**
   * Measured before paint, so it never flashes at the unplaced position. One pass is enough
   * because `scrollWidth`/`scrollHeight` are the *content's* size, which the caps this pass
   * applies do not change - measuring the laid-out box instead would feed the cap back into
   * the measurement and oscillate.
   *
   * **It re-places rather than the menu closing, which is what it used to do on any scroll or
   * resize.** Closing was a cheap stand-in for "a fixed popover drifts from its anchor", and it
   * misfired on the two cases that matter on a phone: a virtual keyboard is a resize, so
   * tapping a number field shut the menu the field is in; and a reflow makes scroll containers
   * emit scroll events, so *any* relayout could close a menu nobody had touched. Following the
   * anchor is the honest version of the same intent - and it means a flyout tracks its row when
   * a long list is scrolled, instead of being left behind. The popover only gives up when the
   * anchor has genuinely gone, which is the case closing was there for.
   */
  useLayoutEffect(() => {
    const place = () => {
      const popover = ref.current;
      const anchor = anchorRef.current;
      if (!popover || !anchor) return;
      const box = anchor.getBoundingClientRect();
      if (box.bottom < 0 || box.right < 0 || box.top > window.innerHeight || box.left > window.innerWidth)
        return onDetachedRef.current();
      const next = placeMenu(
        box,
        { width: popover.scrollWidth, height: popover.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { strategy, side },
      );
      setPlaced((current) =>
        current && (Object.keys(next) as (keyof Placed)[]).every((key) => current[key] === next[key]) ? current : next,
      );
    };
    place();
    // Capture, so a scroll in any container between the anchor and the document is seen -
    // scroll does not bubble. `visualViewport` covers iOS, where a keyboard moves that and
    // leaves `innerHeight` alone.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * A number field as a menu row. Typing is the point (tempo is 20-300), and the − / + buttons
 * are there because on touch a nudge otherwise costs a keyboard.
 *
 * The draft is held as text rather than a number so a half-typed "1" on the way to "140" does
 * not snap the project to the minimum under your finger; it commits whatever parses, and the
 * store clamps. An external change (undo, the agent, the other field) resyncs it, adjusted
 * during render rather than in an effect so it lands before paint.
 */
function NumberRow({
  label,
  number,
  disabled,
  reserveCheck,
}: {
  label?: string;
  number: MenuNumber;
  disabled?: boolean;
  reserveCheck: boolean;
}) {
  const { value, min, max, step = 1, unit, onChange } = number;
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }

  const commit = (text: string) => {
    setDraft(text);
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
  };
  const nudge = (delta: number) => onChange(clamp(value + delta * step, min, max));
  const nudgeClass =
    "shrink-0 flex items-center justify-center w-7 h-7 rounded-md border border-line bg-ground text-[15px] leading-none text-muted cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div role="group" aria-label={label} className="flex items-center gap-2 px-3 py-1 text-[12.5px] text-ink">
      {reserveCheck && <span aria-hidden="true" className="w-3 shrink-0" />}
      <span className="flex-1 whitespace-nowrap">{label}</span>
      <button
        type="button"
        aria-label={`${label} down`}
        disabled={disabled || value <= min}
        onClick={() => nudge(-1)}
        className={nudgeClass}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => commit(event.target.value)}
        // Leaving the field with nothing usable in it puts the live value back, so the row
        // never sits showing a number the project does not have.
        onBlur={() => setDraft(String(value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-14 shrink-0 font-mono text-[12.5px] text-center px-1 py-1 rounded-md border border-line bg-ground text-bright"
      />
      <button
        type="button"
        aria-label={`${label} up`}
        disabled={disabled || value >= max}
        onClick={() => nudge(1)}
        className={nudgeClass}
      >
        +
      </button>
      {unit && <span className="shrink-0 font-mono text-[10px] text-muted">{unit}</span>}
    </div>
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
  if (item.heading)
    return (
      // A rule above rather than a separator item, so a group is one thing in the list and
      // cannot be left with a stray divider when it publishes nothing.
      <div
        role="presentation"
        className="mt-1.5 pt-1.5 px-3 pb-0.5 border-t border-line font-mono text-[10px] uppercase tracking-wider text-muted first:mt-0 first:pt-0 first:border-t-0"
      >
        {item.heading}
      </div>
    );
  if (item.number)
    return <NumberRow label={item.label} number={item.number} disabled={item.disabled} reserveCheck={reserveCheck} />;
  // Show the check column for radio items; reserve an empty one on the menu's other
  // rows when any sibling is checkable, so plain/submenu rows still line up.
  // Hidden from assistive tech: `aria-checked` on the row already says it, and left visible
  // the glyph joins the accessible name ("✓ Velocity lane"), which is a worse label and a
  // moving target for anything matching on it.
  const check =
    item.checked !== undefined || reserveCheck ? (
      <span aria-hidden="true" className="w-3 shrink-0 text-you">
        {item.checked ? "✓" : ""}
      </span>
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
          {/* Decoration: `aria-haspopup` above is what says there is more behind this row. */}
          <span aria-hidden="true" className="text-muted text-[10px]">
            {side === "left" ? "◂" : "▸"}
          </span>
        </button>
        {open && (
          <Popover
            anchorRef={rowRef}
            strategy="beside"
            side={side}
            // The row scrolled out of the list it lives in: this level goes, the rest stays.
            onDetached={onClose}
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
          // Position first: a menu gathering several surfaces' controls has honest duplicates
          // ("Snap to grid" belongs to both the arrangement and the roll), so the label alone
          // is not an identity. The label still rides along, so a row whose label changes
          // ("Quantize 3 selected") remounts rather than keeping a stale field's draft.
          key={`${index}:${item.label ?? item.heading ?? ""}`}
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
   * folds in every mounted surface's controls (`surfaceControls.ts`) and is not re-rendered
   * when one of those surfaces' own state changes. An array captured by the caller's last render
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
    // Scroll and resize are not handled here: each popover follows its anchor instead, and
    // says so (`onDetached`) when the anchor has left the viewport - see the note in Popover.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
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
        <Popover anchorRef={triggerRef} strategy="below" side={align} onDetached={() => setOpen(false)}>
          {() => <MenuList items={rows} side={submenuSide} onDismiss={() => setOpen(false)} />}
        </Popover>
      )}
    </>
  );
}
