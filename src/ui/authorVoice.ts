/**
 * The two reserved author voices and their default accent hexes: "you" = teal (the local user), the
 * agent = violet. These are the single source of truth for the `--color-*` CSS vars (index.css) and
 * the author-colour swatch defaults (authorColors.ts). Per-author *surface* colours (any user id,
 * not just these) are resolved as inline hex by authorStyle.ts / colorForAuthor - this file only
 * holds the reserved-voice constants and their display labels.
 *
 * Two voices, not three, and none of them names a model: an AI edit is the agent's whatever model is
 * behind it, and it carries the user who drove it in the author id rather than in its colour (see
 * commands/authors.ts).
 */
export type Voice = "you" | "agent";

/** The default accent hex per voice. User overrides layer on top (authorColors.ts). */
export const DEFAULT_VOICE_COLORS: Record<Voice, string> = {
  you: "#56c7c2",
  agent: "#8a5cf0",
};

const LABEL: Record<Voice, string> = { you: "You", agent: "Agent" };

/** Friendly label for a reserved voice (the settings rows). Arbitrary user ids use authorLabel. */
export const voiceLabel = (voice: Voice): string => LABEL[voice];
