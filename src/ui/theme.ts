/**
 * The theme choice, and the one signal that has to exist because of it.
 *
 * The palette itself lives entirely in CSS (`index.css`): dark by default, light under
 * `prefers-color-scheme` unless a `data-theme` attribute overrides it. So switching themes
 * is just writing that attribute, and every `var(--color-*)` in the app follows on its own.
 *
 * The exception is anything that paints to a **canvas**, which holds resolved pixels rather
 * than `var()` references and therefore keeps the old palette until something makes it draw
 * again. `useThemeVersion` is that something: one shared subscription to both ways a theme
 * can change (the attribute, and the OS preference when the choice is "system"), so a
 * canvas can list it as an effect dependency instead of every component growing its own
 * observer.
 */
import { useEffect, useSyncExternalStore } from "react";
import { usePersistentString } from "./usePersistent";

export const THEME_CHOICES = ["system", "dark", "light"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

const STORAGE_KEY = "web-daw:theme";

/**
 * The colour the browser paints its own chrome with around an installed app (MOBILE-3): the
 * title bar on Android, the status bar area on iOS. It matches the app's frame rather than its
 * ground, since that is the band it sits directly above.
 *
 * It has to be kept in step by hand, because `<meta name="theme-color">` holds a resolved
 * colour rather than a `var()`, so it is the one part of the palette that does not follow on
 * its own. Two static metas with `prefers-color-scheme` would look like the answer and get the
 * override exactly backwards: choosing light on a dark OS would keep a dark title bar.
 */
const THEME_COLOR = { dark: "#0f1216", light: "#eceff3" } as const;

function syncThemeColor(): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolveTheme()]);
}

/** Write the choice to the document. "system" means *remove* the attribute, not set it. */
function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  syncThemeColor();
}

/**
 * Applied from `main.tsx` before the first render. Doing it in a component effect instead
 * would paint the default theme for a frame and then correct it, which is a flash of the
 * wrong colour scheme on every load for anyone who is not on the default.
 */
export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const choice = THEME_CHOICES.find((candidate) => candidate === stored) ?? "system";
    applyTheme(choice);
  } catch {
    // Private mode, or storage blocked. The default theme is already correct.
  }
  // Also on the OS preference, which is what the default "system" choice resolves through.
  // Attached here rather than lazily in `watch()`, since the chrome colour is wrong from the
  // first paint if nothing has happened to subscribe yet.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", syncThemeColor);
  syncThemeColor();
}

/** The persisted choice, kept in step with the document attribute. */
export function useThemeChoice() {
  const [choice, setChoice] = usePersistentString<ThemeChoice>(STORAGE_KEY, "system", THEME_CHOICES);
  useEffect(() => applyTheme(choice), [choice]);
  return [choice, setChoice] as const;
}

// --- the canvas signal ------------------------------------------------------

const listeners = new Set<() => void>();
let version = 0;
let watching = false;

const bump = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

/** One observer for the whole app, started lazily on the first subscription. */
function watch(): void {
  if (watching) return;
  watching = true;
  new MutationObserver(bump).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  // Only matters while the choice is "system", but a listener that fires a no-op repaint
  // occasionally is cheaper than tearing it down and rebuilding it on every choice change.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", bump);
}

/**
 * A counter that changes whenever the resolved theme does. Meaningless as a value; it
 * exists to be an effect dependency for canvas painters (see `Waveform`).
 */
export function useThemeVersion(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      watch();
      listeners.add(onStoreChange);
      return () => void listeners.delete(onStoreChange);
    },
    () => version,
    () => version,
  );
}

/** Which ground things are actually being drawn on, once the choice and the OS are resolved. */
function resolveTheme(): "dark" | "light" {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The resolved theme, re-read whenever it changes. Needed by anything that has to *compute* a
 * colour rather than name one: the author palette is re-lit for a white ground, and a canvas
 * paints resolved pixels. Everything else should just use a `--color-*` token and get this
 * for free from CSS.
 */
export function useResolvedTheme(): "dark" | "light" {
  // The same subscription as `useThemeVersion`, reading the resolved theme rather than a
  // counter. A string snapshot compares by value, so this re-renders on a real change and
  // not on every notification.
  return useSyncExternalStore(
    (onStoreChange) => {
      watch();
      listeners.add(onStoreChange);
      return () => void listeners.delete(onStoreChange);
    },
    resolveTheme,
    () => "dark",
  );
}
