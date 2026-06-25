/**
 * A small reusable kebab (⋮) context menu: an icon trigger that opens a popover of
 * actions, closing on an outside click, Escape, or scroll. Shared by track / group /
 * patch rows and the arrangement's add menu so "more actions" feels the same
 * everywhere.
 *
 * The popover renders in a portal on document.body with fixed positioning, so it is
 * never clipped by a row's overflow or painted over by a sibling row's controls (the
 * track headers stack, so an in-flow popover got covered). Only one menu is open at a
 * time (opening one closes any other). The trigger stops pointer/click propagation so
 * opening never triggers the row's select/drag underneath.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

// App-wide: only one menu open at a time.
let closeActiveMenu: (() => void) | null = null;

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
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                  item.onClick();
                }}
                className={`block w-full text-left whitespace-nowrap px-3 py-1.5 text-[12.5px] cursor-pointer hover:bg-you/10 disabled:opacity-40 disabled:cursor-not-allowed ${
                  item.danger ? "text-claude" : "text-ink"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
