/**
 * The kebab on the arrangement's paste marker, for touch (MOBILE-17).
 *
 * The same shape as a selected clip's kebab in `ObjectHandles`: hidden for a mouse, which has
 * right-click, drag-and-drop and Cmd+V, and shown for a coarse pointer, which has none of them.
 *
 * **It sits LEFT of the marker, and that is load-bearing.** The marker appears on finger-up, and
 * the browser's click for that same tap follows a moment later at the same point. Anything
 * rendered under the finger in between takes that click - so a kebab to the right of the line
 * opened its menu by accident, and the tap meant to open it closed it again. The marker floors
 * to the grid, so the finger is always at or right of it, and the left side is always clear.
 */
import { Menu, type MenuItem } from "../Menu";
import { iconButtonClass } from "../controls/iconButtonStyle";
import { ROW_PX } from "./shared";

const WRAPPER = "absolute z-6 hidden [@media(pointer:coarse)]:block -translate-y-1/2";

/** Legible over the grid it floats on, matching the clip kebab. */
const TRIGGER = iconButtonClass({ size: "md", className: "bg-card border border-line shadow-sm" });

/** The trigger's width plus a gap clear of the marker's diamond (`iconButtonClass` size md is 32px). */
const OFFSET_X = 38;

export function MarkerMenu({ left, items }: { left: number; items: () => MenuItem[] }) {
  return (
    <div
      data-testid="marker-actions"
      className={WRAPPER}
      style={{ left: Math.max(0, left - OFFSET_X), top: ROW_PX / 2 }}
    >
      <Menu items={items} label="Marker actions" align="left" triggerClassName={TRIGGER} />
    </div>
  );
}
