/**
 * Voice presence: map an edit/clip/commit author to its accent classes, in one place so
 * every author-coloured surface (activity feed, clip rail, version timeline, patch list)
 * stays consistent. Three voices: "you" = teal, the built-in agent = violet, "claude" =
 * coral (the MCP / Claude Code driver, which is genuinely Claude). Old projects that only
 * know "you"/"claude" still map correctly; adding a voice is one entry here.
 */
export type Voice = "you" | "agent" | "claude";

/** The default accent hex per voice. The single source of truth for the `--color-*` CSS vars
 *  (index.css) and the author-colour swatch defaults (authorColors.ts); user overrides layer on top. */
export const DEFAULT_VOICE_COLORS: Record<Voice, string> = {
  you: "#56c7c2",
  agent: "#a884f3",
  claude: "#d9775a",
};

export function voiceOf(author: string): Voice {
  return author === "agent" ? "agent" : author === "claude" ? "claude" : "you";
}

const DOT: Record<Voice, string> = { you: "bg-you", agent: "bg-agent", claude: "bg-claude" };
const BORDER: Record<Voice, string> = { you: "border-you", agent: "border-agent", claude: "border-claude" };
const LABEL: Record<Voice, string> = { you: "You", agent: "Agent", claude: "Claude" };

// Full literal class strings per voice (not built by interpolation) so Tailwind's scanner emits
// every variant. Used for the last-editor note tint: fill + border by author, selected variant ringed.
const NOTE_FILL: Record<Voice, string> = {
  you: "bg-you border border-you/40 hover:brightness-125",
  agent: "bg-agent border border-agent/40 hover:brightness-125",
  claude: "bg-claude border border-claude/40 hover:brightness-125",
};
const NOTE_SELECTED: Record<Voice, string> = {
  you: "bg-bright border border-you ring-1 ring-you",
  agent: "bg-bright border border-agent ring-1 ring-agent",
  claude: "bg-bright border border-claude ring-1 ring-claude",
};

// Timeline placement blocks + their note-summary bars, tinted by the clip's / note's last editor.
const BLOCK_UNSELECTED: Record<Voice, string> = {
  you: "border-line border-t-2 border-t-you bg-card hover:bg-card/70",
  agent: "border-line border-t-2 border-t-agent bg-card hover:bg-card/70",
  claude: "border-line border-t-2 border-t-claude bg-card hover:bg-card/70",
};
const BLOCK_SELECTED: Record<Voice, string> = {
  you: "border-you bg-you/25 ring-1 ring-you",
  agent: "border-agent bg-agent/25 ring-1 ring-agent",
  claude: "border-claude bg-claude/25 ring-1 ring-claude",
};
const BLOCK_TINT: Record<Voice, string> = { you: "bg-you/10", agent: "bg-agent/10", claude: "bg-claude/10" };
const MINI: Record<Voice, string> = { you: "bg-you/85", agent: "bg-agent/85", claude: "bg-claude/85" };
const FILL: Record<Voice, string> = { you: "bg-you/70", agent: "bg-agent/70", claude: "bg-claude/70" };
const INDICATOR: Record<Voice, string> = { you: "bg-you", agent: "bg-agent", claude: "bg-claude" };

export const voiceDot = (author: string): string => DOT[voiceOf(author)];
export const voiceBorder = (author: string): string => BORDER[voiceOf(author)];
export const voiceLabel = (author: string): string => LABEL[voiceOf(author)];
/** Note-rectangle classes tinted by the note's last editor (see PianoRoll). */
export const voiceNoteClass = (author: string, selected: boolean): string =>
  (selected ? NOTE_SELECTED : NOTE_FILL)[voiceOf(author)];
/** Placement-block classes tinted by the clip's last editor (see the arrangement Lane). */
export const voiceBlockClass = (author: string, selected: boolean): string =>
  (selected ? BLOCK_SELECTED : BLOCK_UNSELECTED)[voiceOf(author)];
/** The faint inner-fill tint of a placement block. */
export const voiceBlockTint = (author: string): string => BLOCK_TINT[voiceOf(author)];
/** A note-summary bar inside a placement block, tinted by that note's last editor. */
export const voiceMiniClass = (author: string): string => MINI[voiceOf(author)];
/** A fader's fill (70% opacity) tinted by the param's last editor (see Knob). */
export const voiceFill = (author: string): string => FILL[voiceOf(author)];
/** A knob's pointer (solid) tinted by the param's last editor (see Knob). */
export const voiceIndicator = (author: string): string => INDICATOR[voiceOf(author)];
