/**
 * A small reusable kebab (⋮) context menu: an icon trigger that opens a popover of
 * actions, closing on an outside click, Escape, or scroll. Shared by track / group /
 * patch rows, the arrangement's add menu, and the recording settings menu so "more
 * actions" feels the same everywhere.
 *
 * The popover renders in a portal on document.body with fixed positioning, so it is
 * never clipped by a row's overflow or painted over by a sibling row's controls. Only
 * one (top-level) menu is open at a time. Items can carry a `checked` flag (radio-style
 * selection) or a `submenu` that opens as a hover flyout to the side - the flyout side
 * follows `align`, so a right-aligned menu flies its submenus left (toward the viewport).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

/** One row in a popover: a leaf action, a radio selection, or a submenu parent. */
function Row({ item, side, onClose }: { item: MenuItem; side: "left" | "right"; onClose: () => void }) {
  const [openSub, setOpenSub] = useState(false);
  if (item.separator) return <div role="separator" className="my-1 border-t border-line" />;
  // A check column only when this item participates in a radio group, so plain
  // action menus aren't indented by an empty gutter.
  const check = item.checked !== undefined ? <span className="w-3 shrink-0 text-you">{item.checked ? "✓" : ""}</span> : null;

  if (item.submenu) {
    return (
      <div className="relative" onMouseEnter={() => setOpenSub(true)} onMouseLeave={() => setOpenSub(false)}>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSub}
          disabled={item.disabled}
          // Open on click too (touch, where there is no hover). Not a toggle: a real
          // click is preceded by mouseenter, which would otherwise immediately re-close.
          onClick={(e) => {
            e.stopPropagation();
            setOpenSub(true);
          }}
          className={itemClass(item.danger)}
        >
          {check}
          <span className="flex-1">{item.label}</span>
          <span className="text-muted text-[10px]">{side === "left" ? "◂" : "▸"}</span>
        </button>
        {openSub && (
          <div
            role="menu"
            className={`absolute top-0 ${
              side === "left" ? "right-full" : "left-full"
            } min-w-44 py-1 rounded-lg border border-line bg-card shadow-lg z-50`}
          >
            {item.submenu.map((sub, i) => (
              <Row key={sub.label ?? i} item={sub} side={side} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
      aria-checked={item.checked}
      disabled={item.disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
        item.onClick?.();
      }}
      className={itemClass(item.danger)}
    >
      {check}
      <span className="flex-1">{item.label}</span>
    </button>
  );
}

export function Menu({
  items,
  label = "More actions",
  align = "right",
  triggerClassName = "shrink-0 px-1 text-[15px] leading-none text-muted hover:text-ink cursor-pointer",
}: {
  items: MenuItem[];
  label?: string;
  align?: "left" | "right";
  triggerClassName?: string;
}) {
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const open = coords !== null;
  // Right-aligned menus sit near the viewport's right edge, so their submenus fly left.
  const submenuSide = align === "right" ? "left" : "right";

  const closeMenu = () => setCoords(null);

  const openMenu = () => {
    closeActiveMenu?.(); // enforce a single open menu
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setCoords({ top: r.bottom + 4, ...(align === "right" ? { right: window.innerWidth - r.right } : { left: r.left }) });
  };

  useEffect(() => {
    if (!open) return;
    closeActiveMenu = closeMenu;
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onReflow = () => closeMenu(); // a fixed popover would drift on scroll/resize
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
      if (closeActiveMenu === closeMenu) closeActiveMenu = null;
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
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (open) closeMenu();
          else openMenu();
        }}
        className={triggerClassName}
      >
        ⋮
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, left: coords.left, right: coords.right }}
            className="z-50 min-w-40 py-1 rounded-lg border border-line bg-card shadow-lg"
          >
            {items.map((item, i) => (
              <Row key={item.label ?? i} item={item} side={submenuSide} onClose={closeMenu} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
