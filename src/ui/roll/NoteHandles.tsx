/**
 * What a selected note grows: a grab handle at each end, and a kebab of actions pinned to its
 * right edge (MOBILE-7).
 *
 * **Selection is the substitute for hover.** Touch has none, no modifiers and a 44px finger, so
 * the desktop roll's 6px drag-edge does not transfer - and it cannot simply be widened in
 * place, because at a 12px row height every note would become its neighbour's grab target.
 * Hanging the handles off the *selected* note instead means there are only ever two of them, so
 * they can be finger-sized without costing anything.
 *
 * The hit area and the paint are separate, which is the whole trick: the visible bar stays the
 * height of the note it belongs to, while the box that catches the finger is 44px square on a
 * coarse pointer and stays small on a mouse.
 *
 * The kebab carries the actions instead of a bar pinned to the screen. It costs no permanent
 * space, which landscape cannot spare, and it means the actions are ordinary `MenuItem`s rather
 * than a bespoke toolbar. It is clamped into view (see `visibleRange.ts`) so a long note or a
 * scrolled one does not take its own actions off screen.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent, type RefObject } from "react";
import type { NoteEvent } from "../../audio/sequencer/types";
import { beatToX } from "../timeline/timeGrid";
import { Menu, type MenuItem } from "../Menu";
import { iconButtonClass } from "../controls/iconButtonStyle";
import { clampIntoView } from "./visibleRange";

/** The kebab's own width (`w-8`), so the clamp keeps its far edge on screen and not its near one. */
const KEBAB_WIDTH = 32;
/** Clear of the end handle, which straddles the note's right edge. */
const KEBAB_GAP = 10;

/**
 * A finger-sized box around a bar the size of the note. `--handle-height` carries the note's
 * height in, so the paint can track the row height while the hit area does not.
 */
const HANDLE_HIT_AREA =
  "absolute z-6 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none " +
  "w-3 h-[var(--handle-height)] [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11";
const HANDLE_BAR = "w-1.5 h-[var(--handle-height)] min-h-2 rounded-full bg-you pointer-events-none";

/** Legible over the grid it floats on, unlike the bare icon buttons in the toolbars. */
const KEBAB_CLASS = iconButtonClass({ size: "md", className: "bg-card border border-line shadow-sm" });

const EDGES = ["start", "end"] as const;

export function NoteHandles({
  note,
  topPitch,
  pxPerBeat,
  rowH,
  leadPx,
  scrollRef,
  onResize,
  menuItems,
}: {
  note: NoteEvent;
  /** Pitch of the roll's top row, which is what turns a pitch into a row offset. */
  topPitch: number;
  pxPerBeat: number;
  rowH: number;
  /** The sticky label column's width, which the kebab's clamp has to allow for. */
  leadPx: number;
  /** The scroller the kebab is kept inside. */
  scrollRef: RefObject<HTMLElement | null>;
  onResize: (edge: "start" | "end", event: PointerEvent) => void;
  menuItems: MenuItem[] | (() => MenuItem[]);
}) {
  const kebabRef = useRef<HTMLDivElement>(null);
  const left = beatToX(note.start, pxPerBeat);
  const right = beatToX(note.start + note.length, pxPerBeat);
  const centreY = (topPitch - note.pitch) * rowH + rowH / 2;
  // A row can be 7px tall, where a bar the height of the note is a smudge. The floor is on the
  // paint only; what the finger has to hit is unaffected.
  const handleHeight = { "--handle-height": `${Math.max(rowH - 1, 8)}px` } as CSSProperties;

  /**
   * The kebab's position is written to the element rather than rendered, because it depends on
   * the scroll offset and re-rendering the roll on every scroll frame is not affordable.
   *
   * Held in a ref and refreshed on every render (the pattern `Menu`'s popover uses for the
   * same reason): the scroll listener outlives the render that set it up, so closing over this
   * render's note geometry would leave it placing against a stale one.
   */
  const place = () => {
    const scroller = scrollRef.current;
    const element = kebabRef.current;
    if (!scroller || !element) return;
    element.style.left = `${clampIntoView({
      wanted: right + KEBAB_GAP,
      width: KEBAB_WIDTH,
      scrollLeft: scroller.scrollLeft,
      clientWidth: scroller.clientWidth,
      leadPx,
    })}px`;
  };
  const placeRef = useRef(place);
  // Before paint, so the kebab never shows for a frame at the unplaced position (left: 0,
  // which is the far side of the roll from wherever the note is).
  useLayoutEffect(() => {
    placeRef.current = place;
    place();
  });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => placeRef.current();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          data-testid={`note-handle-${edge}`}
          className={HANDLE_HIT_AREA}
          style={{ ...handleHeight, left: edge === "start" ? left : right, top: centreY }}
          onPointerDown={(event) => onResize(edge, event)}
        >
          <div className={HANDLE_BAR} style={handleHeight} />
        </div>
      ))}
      <div ref={kebabRef} data-testid="note-actions" className="absolute z-6 -translate-y-1/2" style={{ top: centreY }}>
        <Menu items={menuItems} label="Note actions" align="left" triggerClassName={KEBAB_CLASS} />
      </div>
    </>
  );
}
