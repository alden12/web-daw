/**
 * The editor, as a sheet over the arrangement (MOBILE-5).
 *
 * This replaces the touch shell's bottom tabs. The desktop does not tab between its
 * surfaces, it *occludes* - `CenterWorkbench` is editor-above-rack floating over the
 * timeline - so mobile is the desktop occluded rather than the desktop split four ways.
 * Dragging the sheet down reveals more arrangement; throwing it up buries it.
 *
 * **Non-modal, deliberately, and it is load-bearing.** The arrangement behind stays live:
 * you tap a track there while the sheet is up and the selection follows without the sheet
 * moving. That rules out every off-the-shelf bottom sheet (all built on a modal dialog
 * primitive, so they trap focus and `inert` the background), and it is why this is not
 * `Sheet.tsx` - the library and agent sheets genuinely are modal, and sharing an
 * implementation would mean one of the two behaving wrongly.
 *
 * Gesture and detent maths live in `useSheetDrag.ts` and `detents.ts`.
 */
import type { ReactNode } from "react";
import { DETENT_ORDER, stepDetent, type Detent, type DetentSet } from "./detents";
import { useSheetDrag } from "./useSheetDrag";

/**
 * The grabber and title row, as a number. It is a constant rather than a measurement because
 * the thing that needs it - the pads, sizing themselves to the room left over - must not be
 * told how tall a sheet mid-throw is: it is held at full height and translated, so measuring
 * would grow a pad row during the gesture and take it back on settle.
 */
export const SHEET_HEADER_HEIGHT = 65;

export function EditorSheet({
  detent,
  detents,
  onDetentChange,
  title,
  subtitle,
  controls,
  children,
}: {
  detent: Detent;
  detents: DetentSet;
  onDetentChange: (next: Detent) => void;
  /** The selected track's name. */
  title: string;
  /** Its kind, in the slot the desktop editor tab uses for the same thing. */
  subtitle?: string;
  /** The Edit / Rack switch, which opts out of the drag by being buttons. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const { sheetRef, handleProps } = useSheetDrag({ detent, detents, onDetentChange });

  return (
    <div
      ref={sheetRef}
      data-testid="editor-sheet"
      data-detent={detent}
      aria-label="Editor"
      className="absolute bottom-0 left-0 right-0 flex flex-col rounded-t-2xl border-t border-line bg-panel shadow-[0_-14px_40px_-12px_var(--sheet-shadow)] will-change-transform"
      // The insets go here rather than as padding on the workspace: an absolutely
      // positioned box resolves against its containing block's *padding box*, so padding
      // out there would be silently ignored by this element (MOBILE-8).
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/*
       * The whole header drags, not just the grabber - it is the easiest thing on screen
       * to catch mid-idea, and a 4px pill is a cruel target for a thumb. `touch-action:
       * none` is the line that makes any of this work on iOS: without it the browser
       * claims the gesture before the first pointer event arrives.
       */}
      <div {...handleProps} className="shrink-0 touch-none cursor-grab active:cursor-grabbing">
        <div className="flex justify-center pt-2 pb-1.5">
          <span className="w-10 h-1 rounded-full bg-faint" />
        </div>
        <div className="flex items-center gap-2 px-3 pb-2 border-b border-line">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Editor height"
            aria-valuemin={0}
            aria-valuemax={DETENT_ORDER.length - 1}
            aria-valuenow={DETENT_ORDER.indexOf(detent)}
            aria-valuetext={detent}
            onKeyDown={(event) => {
              const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
              if (!direction) return;
              event.preventDefault();
              onDetentChange(stepDetent(detent, direction as 1 | -1));
            }}
            className="min-w-0 flex flex-col leading-tight outline-none focus-visible:ring-1 focus-visible:ring-you rounded"
          >
            <span className="truncate text-[13px] font-semibold text-strong">{title}</span>
            {subtitle && <span className="font-mono text-[9px] tracking-wider uppercase text-faint">{subtitle}</span>}
          </div>
          {controls}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
