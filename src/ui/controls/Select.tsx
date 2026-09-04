/**
 * A dropdown.
 *
 * The thing worth centralising is the ground it sits on. A select is a **field**, not a
 * button: somewhere you go to choose a value, rather than something that acts when pressed.
 * So it takes the page's base ground - near-black on dark, white on light - instead of the
 * raised grey a control wears, which keeps the two families telling you apart what they are.
 *
 * They had drifted before this existed: some `bg-card`, some `bg-ground`, so the same
 * dropdown looked like a different kind of thing depending on which panel it landed in.
 *
 * Children rather than an `options` prop, unusually for this codebase, because several call
 * sites group with `<optgroup>` (the sample picker's built-in / imported split) and a flat
 * data prop cannot express that - it would push exactly those sites back to hand-rolling the
 * element, which is the drift this is here to stop.
 */
import type { ReactNode, SelectHTMLAttributes } from "react";
import { TONE_FOCUS, type Tone } from "./tone";

export type SelectSize = "sm" | "md" | "lg";

/**
 * Taken from what the call sites already used, so adopting this changed no layout: `sm` is an
 * inline toolbar dropdown, `md` one sitting in a row of text, `lg` a labelled field in a
 * settings sheet.
 */
const SIZE: Record<SelectSize, string> = {
  sm: "text-[11px] px-1.5 py-1 rounded-md",
  md: "text-[12.5px] px-2 py-1 rounded-md",
  lg: "text-[12.5px] px-2.5 py-2 rounded-md",
};

export function Select({
  size = "sm",
  tone = "you",
  className = "",
  children,
  ...rest
}: {
  size?: SelectSize;
  /** Which colour the focus ring speaks in, for a surface that is not the default. */
  tone?: Tone;
  children?: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`bg-ground border border-line text-ink cursor-pointer transition-colors hover:border-line-soft ${
        TONE_FOCUS[tone]
      } focus-visible:outline-offset-1 ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
