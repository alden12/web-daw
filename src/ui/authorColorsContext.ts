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
}

const AuthorColorsContext = createContext<AuthorPresence>({ config: {}, self: "you" });

export const AuthorColorsProvider = AuthorColorsContext.Provider;

/** The current author-colour config + viewer identity, reactive to changes. */
export const useAuthorPresence = (): AuthorPresence => useContext(AuthorColorsContext);
