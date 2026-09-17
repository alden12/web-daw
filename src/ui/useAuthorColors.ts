/**
 * React binding for the author-colour store (authorColors.ts). The snapshot is referentially
 * stable between writes, so it is a safe external store. `useSyncAuthorColorVars` writes the
 * three voice colours into the `--color-*` CSS custom properties on :root, so every author-
 * coloured surface (which already reads those vars) recolours live when the user picks swatches.
 */
import { useEffect, useSyncExternalStore } from "react";
import { readAuthorColors, subscribeAuthorColors, type AuthorColorConfig } from "./authorColors";
import { DEFAULT_VOICE_COLORS, type Voice } from "./authorVoice";

export function useAuthorColors(): AuthorColorConfig {
  return useSyncExternalStore(subscribeAuthorColors, readAuthorColors, readAuthorColors);
}

const VOICES: Voice[] = ["you", "agent", "claude"];

/** Push the configured (or default) voice colours into the root CSS variables. */
export function useSyncAuthorColorVars(config: AuthorColorConfig): void {
  useEffect(() => {
    const root = document.documentElement;
    for (const voice of VOICES) {
      root.style.setProperty(`--color-${voice}`, config[voice] ?? DEFAULT_VOICE_COLORS[voice]);
    }
  }, [config]);
}
