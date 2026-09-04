/**
 * The class string an icon button wears, without the button.
 *
 * Its own module rather than a second export from `IconButton.tsx`, because a file that
 * exports both a component and a helper loses fast refresh (`react-refresh/only-export-components`).
 *
 * It exists because a few controls cannot *be* an `IconButton` but have to look like one
 * sitting beside them: `Menu` renders its own trigger element and takes a class string for it,
 * and those triggers sit in the same rows as real icon buttons. Sharing the string is the only
 * thing that keeps them in step - there were three hand-written variants of "bare 36px square"
 * across the shell and the pads before this, and they had already drifted apart.
 */
import { CONTROL_BASE, TONE_ACTIVE, TONE_HOVER, TONE_TEXT, type Tone } from "./tone";

export type IconButtonSize = "sm" | "md" | "lg";

/**
 * Square, so a row of them is even whatever glyph each holds. Touch wants `lg`.
 *
 * Glyph sizes are deliberately generous: a stroked arrow or a chevron set at the size that
 * looks right in prose reads as a speck in a control, and cramped glyph buttons have been a
 * repeated complaint (see CLAUDE.md, "UI glyph icons: size them up").
 */
const SIZE: Record<IconButtonSize, string> = {
  sm: "w-6 h-6 rounded-md text-[15px]",
  md: "w-8 h-8 rounded-lg text-[17px]",
  lg: "w-9 h-9 rounded-lg text-[17px]",
};

export function iconButtonClass({
  size = "md",
  tone = "you",
  active = false,
  toneAtRest = false,
  className = "",
}: {
  size?: IconButtonSize;
  tone?: Tone;
  active?: boolean;
  /** Wear the tone at rest rather than muted grey (a record dot is red before you press it). */
  toneAtRest?: boolean;
  className?: string;
} = {}): string {
  // Bare at rest, but not bare on hover: without a fill there is nothing to tell you the
  // target is bigger than the glyph, and two adjacent icons read as one cluster rather than
  // two targets.
  const resting = `hover:bg-control ${
    toneAtRest ? `${TONE_TEXT[tone]} opacity-80 hover:opacity-100` : `text-muted ${TONE_HOVER[tone]}`
  }`;
  return `${CONTROL_BASE} ${SIZE[size]} ${active ? TONE_ACTIVE[tone] : resting} ${className}`;
}
