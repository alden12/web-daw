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
 *
 * **Only the handles are for both pointers.** The kebab and the move grip are touch's answers
 * to things a mouse already has - a keyboard, a velocity lane, and a drag-edge you can hit - so
 * on a fine pointer they would be furniture floating over the neighbouring notes and paying for
 * nothing. Both are gated by a media query rather than a prop, so there is no "touch mode" to
 * be in or out of: the roll renders the same tree and CSS decides what a pointer earns.
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
 * A finger-sized box around a bar. `--handle-height` carries the note's own height in, so on a
 * mouse the bar tracks the row height and stays the discreet thing it always was.
 *
 * **On touch the bar is a fixed 24px, taller than most notes on purpose.** Drawn at the note's
 * height it disappears into the note - same colour, same box - and reads as part of it rather
 * than as something to take hold of. Standing proud at both ends is what says "grip".
 */
const HANDLE_HIT_AREA =
  "absolute z-6 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none " +
  "w-3 h-[var(--handle-height)] [@media(pointer:coarse)]:w-12 [@media(pointer:coarse)]:h-12";
const HANDLE_BAR =
  "w-1.5 h-[var(--handle-height)] min-h-2 rounded-full bg-you pointer-events-none " +
  "[@media(pointer:coarse)]:w-2 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:ring-1 " +
  "[@media(pointer:coarse)]:ring-ground/60";

/**
 * The move grip, which exists because **a fingertip parked on a 12px note covers the note**.
 * You end up dragging something you cannot see, and pitch is exactly the axis where you need to
 * see where you have got to. Offsetting the grip below the note keeps the finger clear of it.
 *
 * Touch only, hence the media query rather than a prop: a mouse has no occlusion problem and
 * dragging the note itself is more direct, so a permanent tab under every selected note would
 * be clutter that buys the desktop nothing.
 */
const MOVE_GRIP =
  "absolute z-6 hidden [@media(pointer:coarse)]:flex flex-col items-center justify-center gap-[3px] " +
  "-translate-x-1/2 w-11 h-7 rounded-full bg-card border border-line shadow-sm cursor-grab touch-none";
const MOVE_GRIP_LINE = "w-4 h-0.5 rounded-full bg-muted pointer-events-none";
const MOVE_GRIP_HEIGHT = 28;
/** Between the note's edge and the grip, so the grip does not touch what it is dragging. */
const MOVE_GRIP_GAP = 8;

/**
 * The kebab is **touch only**, like the move grip and for the same reason: it exists because
 * touch has nowhere else to put these actions. Desktop has the keyboard for delete and for
 * copy/paste, the velocity lane for velocity, and a right-hand drag-edge for resizing, so a
 * button floating over the grid beside every selected note would be permanent furniture paying
 * for nothing - and it would sit on top of the neighbouring notes while it did.
 */
const KEBAB_WRAPPER = "absolute z-6 hidden [@media(pointer:coarse)]:block -translate-y-1/2";

/** Legible over the grid it floats on, unlike the bare icon buttons in the toolbars. */
const KEBAB_CLASS = iconButtonClass({ size: "md", className: "bg-card border border-line shadow-sm" });

const EDGES = ["start", "end"] as const;

export function NoteHandles({
  note,
  topPitch,
  pxPerBeat,
  rowH,
  leadX,
  leadY,
  scrollRef,
  onResize,
  onMove,
  menuItems,
}: {
  note: NoteEvent;
  /** Pitch of the roll's top row, which is what turns a pitch into a row offset. */
  topPitch: number;
  pxPerBeat: number;
  rowH: number;
  /** The sticky label column's width, which the kebab's clamp has to allow for. */
  leadX: number;
  /** The sticky ruler's height, which the move grip's room-below has to allow for. */
  leadY: number;
  /** The scroller these are kept inside. */
  scrollRef: RefObject<HTMLElement | null>;
  onResize: (edge: "start" | "end", event: PointerEvent) => void;
  onMove: (event: PointerEvent) => void;
  menuItems: MenuItem[] | (() => MenuItem[]);
}) {
  const kebabRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const left = beatToX(note.start, pxPerBeat);
  const right = beatToX(note.start + note.length, pxPerBeat);
  const rowTop = (topPitch - note.pitch) * rowH;
  const centreY = rowTop + rowH / 2;
  // A row can be 7px tall, where a bar the height of the note is a smudge. The floor is on the
  // paint only; what the finger has to hit is unaffected.
  const handleHeight = { "--handle-height": `${Math.max(rowH - 1, 8)}px` } as CSSProperties;

  /**
   * The two floating affordances are positioned by writing to the element rather than by
   * rendering, because where they go depends on the scroll offset and re-rendering the roll on
   * every scroll frame is not affordable.
   *
   * Held in a ref and refreshed on every render (the pattern `Menu`'s popover uses for the
   * same reason): the scroll listener outlives the render that set it up, so closing over this
   * render's note geometry would leave it placing against a stale one.
   */
  const place = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (kebabRef.current)
      kebabRef.current.style.left = `${clampIntoView({
        wanted: right + KEBAB_GAP,
        width: KEBAB_WIDTH,
        scrollOffset: scroller.scrollLeft,
        viewportSize: scroller.clientWidth,
        leadPx: leadX,
      })}px`;
    // The grip goes below the note, and above it when there is no room below - a grip you have
    // to scroll to reach is worse than one on the other side. It is not clamped the way the
    // kebab is: it drags the note, so it has to stay attached to where the note actually is.
    if (gripRef.current) {
      const lastVisible = scroller.scrollTop + scroller.clientHeight - leadY;
      const below = rowTop + rowH + MOVE_GRIP_GAP;
      const fits = below + MOVE_GRIP_HEIGHT <= lastVisible;
      gripRef.current.style.top = `${fits ? below : rowTop - MOVE_GRIP_GAP - MOVE_GRIP_HEIGHT}px`;
    }
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
      <div
        ref={gripRef}
        role="button"
        aria-label="Move note"
        data-testid="note-move"
        className={MOVE_GRIP}
        style={{ left: (left + right) / 2 }}
        onPointerDown={onMove}
      >
        <span className={MOVE_GRIP_LINE} />
        <span className={MOVE_GRIP_LINE} />
      </div>
      <div ref={kebabRef} data-testid="note-actions" className={KEBAB_WRAPPER} style={{ top: centreY }}>
        <Menu items={menuItems} label="Note actions" align="left" triggerClassName={KEBAB_CLASS} />
      </div>
    </>
  );
}
