/**
 * A text button.
 *
 * The house rule, worked out by trying six treatments on the real transport bar rather than
 * in isolation: **a text button rests as a subtle grey pill, and wears its accent only while
 * it is doing something.** A word in a toolbar has no edges of its own, so it needs a
 * container to be a target at all; what it does not need is a permanent colour, which is what
 * flattens a dense surface into a row of things all shouting equally.
 *
 * `variant` is deliberately small:
 * - `quiet` (default) - grey at rest, accent when `active`. Almost everything.
 * - `solid` - one primary action per surface, where a tint is not enough (a sign-in, a
 *   destructive confirm). Reach for it once and then stop.
 * - `ghost` - no chrome at all, for a control whose neighbours already frame it (a kebab in
 *   a header row). Still gets a hover, so it is discoverable.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CONTROL_BASE, TONE_ACTIVE, TONE_SOLID, type Tone } from "./tone";

export type ButtonVariant = "quiet" | "solid" | "ghost";
export type ButtonSize = "sm" | "md";

/** Heights are fixed so a row of controls lines up whatever each one contains. */
const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[11.5px] rounded-full",
  md: "h-8 px-3.5 text-[12.5px] rounded-full",
};

const RESTING: Record<ButtonVariant, string> = {
  quiet: "bg-control text-ink hover:bg-control-hover",
  solid: "", // the tone supplies it
  ghost: "text-muted hover:text-ink",
};

export function Button({
  variant = "quiet",
  tone = "you",
  size = "md",
  active = false,
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  /** Which semantic colour this control speaks in when it is active or solid. */
  tone?: Tone;
  size?: ButtonSize;
  /** Currently doing something (playing, recording, enabled). Sets `aria-pressed` too. */
  active?: boolean;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  // Active outranks the resting look for everything except `solid`, which is already the
  // loudest thing on the surface and has nowhere louder to go.
  const look = variant === "solid" ? TONE_SOLID[tone] : active ? TONE_ACTIVE[tone] : RESTING[variant];

  return (
    <button
      type="button"
      // Only a control that *has* a pressed state should claim one, so a plain action button
      // is not announced as a toggle that happens to be off.
      aria-pressed={variant === "solid" ? undefined : active}
      className={`${CONTROL_BASE} ${SIZE[size]} ${look} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
