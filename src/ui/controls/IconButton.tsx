/**
 * An icon-only button.
 *
 * Same rule as `Button` with one deliberate difference: **an icon rests bare.** A word needs
 * a container because it has no edges of its own; an icon is already a shape, so a box around
 * it is a second container saying the same thing twice, and a toolbar of them turns into a
 * row of boxes rather than a row of icons. It takes the accent pill when active, exactly like
 * a text button, so the two read as one system.
 *
 * `label` is required rather than optional. There is no text to fall back on, so an icon
 * button without one is unusable by anything that cannot see it, and it is far too easy to
 * leave off when the glyph looks obvious.
 *
 * The look itself lives in `iconButtonStyle.ts`, so a `Menu` trigger - which renders its own
 * element and cannot be this component - can wear exactly the same thing.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { iconButtonClass, type IconButtonSize } from "./iconButtonStyle";
import type { Tone } from "./tone";

export function IconButton({
  label,
  tone = "you",
  size = "md",
  active = false,
  /** Show the tone at rest rather than in muted grey (a record dot is red before you press it). */
  toneAtRest = false,
  className = "",
  children,
  ...rest
}: {
  /** Accessible name. Used for `aria-label`, and as the tooltip unless `title` overrides it. */
  label: string;
  tone?: Tone;
  size?: IconButtonSize;
  active?: boolean;
  toneAtRest?: boolean;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      aria-pressed={active}
      className={iconButtonClass({ size, tone, active, toneAtRest, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
