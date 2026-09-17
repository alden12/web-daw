/**
 * Context carrying author-colour *presence* down to the many surfaces that tint by author (knobs,
 * notes, arrangement blocks): the colour config AND the viewer's own id (`self`). Colouring is
 * perspective-relative (see authorColors.ts) - my own edits read teal, everyone else in their hue - so
 * a surface needs both. AppShell provides it from `useAuthorColors()` + the current user, so a swatch or
 * identity change re-renders every consumer with the new hue.
 */
import { createContext, useContext } from "react";
import type { AuthorColorConfig } from "./authorColors";

export interface AuthorPresence {
  config: AuthorColorConfig;
  /** The viewer's own author id, painted with the "you" hue. */
  self: string;
  /**
   * The resolved theme. The palette is tuned to glow on a near-black ground, where every
   * swatch clears 6:1; on white the same hues fall to 1.9-3.1:1 and stop being visible as
   * UI at all. So a hue is the identity and its lightness is the theme's, and the surfaces
   * that tint by author need to know which ground they are on. See `authorStyle.ts`.
   */
  theme: "dark" | "light";
}

const AuthorColorsContext = createContext<AuthorPresence>({ config: {}, self: "you", theme: "dark" });

export const AuthorColorsProvider = AuthorColorsContext.Provider;

/** The current author-colour config + viewer identity, reactive to changes. */
export const useAuthorPresence = (): AuthorPresence => useContext(AuthorColorsContext);
