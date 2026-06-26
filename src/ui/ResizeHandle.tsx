/**
 * A drag handle that sits on a panel boundary. It reports the pointer position
 * along its resize axis during a drag (x for a vertical divider between columns,
 * y for a horizontal divider between rows); the parent turns that into a panel
 * size, so the same handle serves a left panel that grows rightward, a right
 * panel that grows leftward, or a bottom panel that grows upward. Uses Pointer
 * Events, so mouse, trackpad, and touch all work - which also lines it up with
 * the mobile/touch roadmap.
 */
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { beginPointerDrag } from "./pointerDrag";

export function ResizeHandle({
  ariaLabel,
  orientation = "vertical",
  onResize,
  onDragChange,
  style,
}: {
  ariaLabel: string;
  /** 'vertical' divides columns (drag x); 'horizontal' divides rows (drag y). */
  orientation?: "vertical" | "horizontal";
  onResize: (clientPos: number) => void;
  onDragChange?: (active: boolean) => void;
  style?: CSSProperties;
}) {
  const cursor = orientation === "vertical" ? "col-resize" : "row-resize";
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDragChange?.(true);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    beginPointerDrag(
      (ev) => onResize(orientation === "vertical" ? ev.clientX : ev.clientY),
      () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onDragChange?.(false);
      },
    );
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      className={`absolute z-10 bg-transparent hover:bg-you/40 transition-colors ${
        orientation === "vertical" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
      }`}
      style={style}
    />
  );
}
