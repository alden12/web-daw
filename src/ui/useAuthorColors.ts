/**
 * React binding for the author-colour store (authorColors.ts). The snapshot is referentially
 * stable between writes, so it is a safe external store. `useSyncAuthorColorVars` writes the
 * three voice colours into the `--color-*` CSS custom properties on :root, so every author-
 * coloured surface (which already reads those vars) recolours live when the user picks swatches.
 */
import { useEffect, useSyncExternalStore } from "react";
import { readAuthorColors, subscribeAuthorColors, type AuthorColorConfig } from "./authorColors";
import { type Voice } from "./authorVoice";
import { authorHex } from "./authorStyle";
import { useResolvedTheme } from "./theme";

export function useAuthorColors(): AuthorColorConfig {
  return useSyncExternalStore(subscribeAuthorColors, readAuthorColors, readAuthorColors);
}

const VOICES: Voice[] = ["you", "agent", "claude"];

/**
 * Push the configured (or default) voice colours into the root CSS variables, re-lit for the
 * ground they will be drawn on.
 *
 * These are written as inline styles on <html>, which outrank any stylesheet, so this is the
 * only place the CSS side of a voice can be themed. It has to apply exactly the same
 * transform as `authorHex` does for the JS side: the two paths meet constantly (a clip block
 * is `authorBlockStyle`, the play button beside it is `text-you`), and any drift shows up as
 * two different teals in one window.
 */
export function useSyncAuthorColorVars(config: AuthorColorConfig): void {
  const presence = { config, self: "you", theme: useResolvedTheme() };
  useEffect(() => {
    const root = document.documentElement;
    for (const voice of VOICES) {
      root.style.setProperty(`--color-${voice}`, authorHex(voice, presence));
    }
    // `presence` is rebuilt each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, presence.theme]);
}
