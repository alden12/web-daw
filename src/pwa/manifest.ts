/**
 * The web app manifest (MOBILE-3), as data rather than as a JSON file.
 *
 * It is here rather than in `public/` because the things that break a manifest are silent: an
 * icon path that does not resolve, a missing size, a `start_url` outside the `scope`. A browser
 * answers all three the same way, by simply not offering to install, with no error anywhere.
 * As a module it is typed, `vite.config.ts` hands it to the plugin, and `test/pwaManifest`
 * checks it against the install criteria and checks every icon file is really on disk.
 *
 * **PWA before Tauri is the deliberate order** (MOBILE-3, MOBILE-4). The gating risk for a
 * DAW on a phone is not the shell, it is whether an OS webview can carry real-time
 * `AudioWorklet` audio - and that risk is identical for a PWA, Tauri and Capacitor, since all
 * three are the same WKWebView / Android WebView underneath. So the cheapest shell goes first,
 * to answer that question on real hardware before anything is committed to a native one.
 */

/** Dark, because the palette's bare `:root` is dark and light is the override. */
const GROUND = "#0a0c0e";

/**
 * The fields we actually set, spelled out rather than taken from the plugin's own
 * `Partial<ManifestOptions>`: everything there is optional, which is the opposite of useful for
 * a document whose whole failure mode is a field that is quietly not there.
 */
export interface WebAppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  orientation: "any" | "portrait" | "landscape";
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: { src: string; sizes: string; type: string; purpose: "any" | "maskable" }[];
}

export const PWA_MANIFEST: WebAppManifest = {
  id: "/",
  name: "web-daw",
  short_name: "web-daw",
  description: "A digital audio workstation in the browser, with an agent that can play it too.",
  start_url: "/",
  scope: "/",
  /**
   * Standalone rather than fullscreen. Fullscreen would buy a phone the status bar's worth of
   * rows, which this app is short of, and on Android it is also what would report real
   * `safe-area-inset-top` (MOBILE-8) - but it takes the clock and the battery with it, which is
   * a lot to charge someone for a few pixels. Worth revisiting if landscape stays cramped.
   */
  display: "standalone",
  /** Both, and the shell already tiers by the room it has (MOBILE-1). */
  orientation: "any",
  /** The splash screen's ground, so the launch does not flash white on the way in. */
  background_color: GROUND,
  /** The browser's own chrome around the app. Kept in step with the theme by `ui/theme.ts`. */
  theme_color: GROUND,
  categories: ["music", "productivity"],
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    /**
     * A launcher crops a maskable icon to whatever shape it likes: a circle, a squircle, a
     * rounded square. The usual advice is to inset the mark to the 80% safe zone so no crop can
     * clip it, which for a circular mark inside a circular crop draws a small circle in a thick
     * dark ring - the first attempt here, and a phone said so.
     *
     * The inset exists to stop a crop eating the artwork, and **a mark already the shape of the
     * crop has nothing to lose**, so it is drawn a whisker past the square's edge instead. See
     * `scripts/generateIcons.ts` for the scales and the alternative.
     */
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
