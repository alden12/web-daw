/**
 * Per-author inline styles: the colour half of author presence for surfaces that tint by *who* last
 * edited (faders, knob pointers, piano-roll notes, arrangement blocks). The class-based `authorVoice.ts`
 * collapses every author to one of three fixed voices (its Tailwind classes are static); these helpers
 * resolve ANY author id via `colorForAuthor` and emit inline styles, so a collaborator's edits show in
 * their own colour. Colouring is perspective-relative, so each takes the viewer's `AuthorPresence`
 * ({ config, self }): the viewer's own edits read teal, everyone else in their hue.
 *
 * Reactivity: get presence from `useAuthorPresence()` (a context fed by the author-colour store + the
 * current user) so a surface recolours live when a swatch or identity changes.
 */
import type { CSSProperties } from "react";
import { colorForAuthor } from "./authorColors";
import type { AuthorPresence } from "./authorColorsContext";

/** #rrggbb -> rgba() at `alpha`, so an accent can tint fills/borders at any opacity (Tailwind's `/NN`). */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The author's accent hex from the viewer's perspective (own = teal, others by id). */
export const authorHex = (author: string, presence: AuthorPresence): string =>
  colorForAuthor(author, presence.config, presence.self);

/** A small coloured dot / solid pointer in the author's colour. */
export const authorDotStyle = (author: string, presence: AuthorPresence): CSSProperties => ({
  background: authorHex(author, presence),
});

/** A translucent fader fill (was `bg-<voice>/70`). */
export const authorFillStyle = (author: string, presence: AuthorPresence, alpha = 0.7): CSSProperties => ({
  background: withAlpha(authorHex(author, presence), alpha),
});

/** A left-accent border (was `border-<voice>`), for feed rows / version markers. */
export const authorBorderStyle = (author: string, presence: AuthorPresence): CSSProperties => ({
  borderLeftColor: authorHex(author, presence),
});

/** A piano-roll note rectangle, tinted by its last editor. Selected reads as bright + ringed. */
export const authorNoteStyle = (author: string, selected: boolean, presence: AuthorPresence): CSSProperties => {
  const hex = authorHex(author, presence);
  return selected
    ? { borderColor: hex, boxShadow: `0 0 0 1px ${hex}` } // ring-1; bg-bright stays a class
    : { background: hex, borderColor: withAlpha(hex, 0.4) };
};

/** An arrangement placement block, tinted by its clip's last editor (top-accent when unselected). */
export const authorBlockStyle = (author: string, selected: boolean, presence: AuthorPresence): CSSProperties => {
  const hex = authorHex(author, presence);
  return selected
    ? { borderColor: hex, background: withAlpha(hex, 0.25), boxShadow: `0 0 0 1px ${hex}` }
    : { borderTopColor: hex };
};

/** The faint inner-fill tint of a placement block (was `bg-<voice>/10`). */
export const authorBlockTintStyle = (author: string, presence: AuthorPresence): CSSProperties => ({
  background: withAlpha(authorHex(author, presence), 0.1),
});

/** A note-summary bar inside a placement block (was `bg-<voice>/85`). */
export const authorMiniStyle = (author: string, presence: AuthorPresence): CSSProperties => ({
  background: withAlpha(authorHex(author, presence), 0.85),
});

/** Display label for an author: the reserved voices get a friendly name; a user id shows as-is. */
export const authorLabel = (author: string): string =>
  author === "claude" ? "Claude" : author === "agent" ? "Agent" : author === "you" ? "You" : author;
