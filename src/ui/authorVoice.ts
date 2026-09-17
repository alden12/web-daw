/**
 * The three reserved author voices and their default accent hexes: "you" = teal (the local user),
 * the built-in agent = violet, "claude" = coral (the MCP / Claude Code driver). These are the single
 * source of truth for the `--color-*` CSS vars (index.css) and the author-colour swatch defaults
 * (authorColors.ts). Per-author *surface* colours (any user id, not just these three) are resolved as
 * inline hex by authorStyle.ts / colorForAuthor - this file only holds the reserved-voice constants and
 * their display labels.
 */
export type Voice = "you" | "agent" | "claude";

/** The default accent hex per voice. User overrides layer on top (authorColors.ts). */
export const DEFAULT_VOICE_COLORS: Record<Voice, string> = {
  you: "#56c7c2",
  agent: "#a884f3",
  claude: "#d9775a",
};

const LABEL: Record<Voice, string> = { you: "You", agent: "Agent", claude: "Claude" };

/** Friendly label for a reserved voice (the settings rows). Arbitrary user ids use authorLabel. */
export const voiceLabel = (voice: Voice): string => LABEL[voice];
