/**
 * The semantic colours a control can carry, and the class strings for each.
 *
 * These are literal strings in a map rather than built from a template, because Tailwind
 * scans source text: a class assembled as `bg-${tone}/15` is invisible to it and would be
 * dropped from the build. The map is also the extension point - a new tone is a new entry
 * here and nothing else.
 *
 * `you` / `agent` / `claude` mirror the edit voices (who did this), so a control tinted
 * `claude` reads as the same actor whose edits are coral. `warn` is a state, not an actor.
 */
export type Tone = "you" | "agent" | "claude" | "warn";

/**
 * A control that is *currently doing something*: recording, playing, armed, a metronome that
 * is on. Emphasis is a property of state rather than a fixed property of a button, so this is
 * the only place an accent appears.
 */
export const TONE_ACTIVE: Record<Tone, string> = {
  you: "bg-you/15 border-you/45 text-you",
  agent: "bg-agent/15 border-agent/45 text-agent",
  claude: "bg-claude/15 border-claude/45 text-claude",
  warn: "bg-warn/15 border-warn/45 text-warn",
};

/** The one primary action on a surface, where a tint is not enough. Used sparingly. */
export const TONE_SOLID: Record<Tone, string> = {
  you: "bg-you text-ground hover:opacity-90",
  agent: "bg-agent text-ground hover:opacity-90",
  claude: "bg-claude text-ground hover:opacity-90",
  warn: "bg-warn text-ground hover:opacity-90",
};

/** The tone as plain text, for a control that carries its colour even at rest (a record dot). */
export const TONE_TEXT: Record<Tone, string> = {
  you: "text-you",
  agent: "text-agent",
  claude: "text-claude",
  warn: "text-warn",
};

/** What a resting control hints at on hover, so the tone is legible before it is pressed. */
export const TONE_HOVER: Record<Tone, string> = {
  you: "hover:text-you",
  agent: "hover:text-agent",
  claude: "hover:text-claude",
  warn: "hover:text-warn",
};

/**
 * The focus ring. A separate map because a field can sit in a surface that speaks a different
 * tone than the default (the agent panel rings in `agent`), and the ring is the one part of a
 * control that has to be visible whatever the surface is doing.
 */
export const TONE_FOCUS: Record<Tone, string> = {
  you: "focus-visible:[outline:2px_solid_var(--color-you)]",
  agent: "focus-visible:[outline:2px_solid_var(--color-agent)]",
  claude: "focus-visible:[outline:2px_solid_var(--color-claude)]",
  warn: "focus-visible:[outline:2px_solid_var(--color-warn)]",
};

/**
 * Shared by every control here. The border is always present and transparent when resting,
 * so activating one floods an existing shape with colour rather than adding a border and
 * shifting everything beside it by a pixel.
 */
export const CONTROL_BASE =
  "inline-flex items-center justify-center gap-1.5 border border-transparent cursor-pointer select-none " +
  "whitespace-nowrap transition-colors focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-1 " +
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";
