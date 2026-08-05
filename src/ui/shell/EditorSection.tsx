/**
 * A collapsible section beneath the roll in the editor sheet (MOBILE-6). The pads are the
 * first; the clip rail is the other, and the device rack will likely want one too, which is
 * why this is a component rather than a shape the pads happen to have.
 *
 * **A section's height is a function of its content, never a drag.** Adding a pad row grows
 * it by exactly one row and the roll gives up exactly that much, which is the whole reason
 * the roll is the flexible box and this is not. An earlier prototype let the roll resize as
 * a keyboard appeared and it was confusing precisely because the amount was unpredictable.
 *
 * That leaves the case where a section's content does not fit at all - a landscape phone at
 * Half, where the whole sheet is under 200px. The section does not solve that by shrinking;
 * its content does, by asking for less (see the pads' `fitPads`). A section that quietly
 * scaled itself down would be a second mechanism arguing with the first.
 *
 * **Visibility is this disclosure and nothing else** - notably not the sheet's detent. Two
 * mechanisms over one thing means you collapse a section and something else reopens it.
 */
import type { ReactNode } from "react";

export function EditorSection({
  title,
  open,
  onToggle,
  controls,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /**
   * The section's own controls, beside the title. Only where they earn the space: a section
   * whose controls fit in a row of their own should keep them near what they act on.
   */
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="shrink-0 border-t border-line" data-section={title.toLowerCase()} data-open={open}>
      <div className="flex items-center gap-1 h-9 px-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="shrink-0 flex items-center gap-1 h-9 text-left cursor-pointer"
        >
          <span
            aria-hidden="true"
            className={`flex items-center justify-center w-6 h-6 shrink-0 text-[16px] leading-none text-muted ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted">{title}</span>
        </button>
        {open && controls}
      </div>
      {open && children}
    </section>
  );
}
