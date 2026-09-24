/**
 * The kebab on the arrangement's paste marker, for touch (MOBILE-17).
 *
 * The same shape as a selected clip's kebab in `ObjectHandles`: hidden for a mouse, which has
 * right-click, drag-and-drop and Cmd+V, and shown for a coarse pointer, which has none of them.
 *
 * Sits just right of the marker line, centred in the lane. The marker drops on the tap's click
 * rather than its pointerup (see `Lane`'s `onLaneClick`), which is what keeps this from catching
 * that same click and opening itself.
 */
import { Menu, type MenuItem } from "../Menu";
import { iconButtonClass } from "../controls/iconButtonStyle";
import { ROW_PX } from "./shared";

const WRAPPER = "absolute z-6 hidden [@media(pointer:coarse)]:block -translate-y-1/2";

/** Legible over the grid it floats on, matching the clip kebab. */
const TRIGGER = iconButtonClass({ size: "md", className: "bg-card border border-line shadow-sm" });

/** Clear of the marker's diamond, so the line stays visible beside the button. */
const OFFSET_X = 6;

export function MarkerMenu({ left, items }: { left: number; items: () => MenuItem[] }) {
  return (
    <div data-testid="marker-actions" className={WRAPPER} style={{ left: left + OFFSET_X, top: ROW_PX / 2 }}>
      <Menu items={items} label="Marker actions" align="left" triggerClassName={TRIGGER} />
    </div>
  );
}
