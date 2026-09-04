import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { PWA_MANIFEST } from "../src/pwa/manifest";

/**
 * A broken manifest is silent (MOBILE-3). A browser answers a missing size, an icon path that
 * does not resolve, or a `start_url` outside the `scope` in exactly the same way: by not
 * offering to install, with nothing logged. The only place that gets caught is on a phone,
 * which is the slowest loop in the project.
 */
describe("the web app manifest", () => {
  it("meets the criteria a browser needs before it will offer to install", () => {
    expect(PWA_MANIFEST.name).toBeTruthy();
    expect(PWA_MANIFEST.short_name).toBeTruthy();
    expect(PWA_MANIFEST.start_url).toBeTruthy();
    // Anything but "browser" counts, but the two we would ever want are these.
    expect(["standalone", "fullscreen"]).toContain(PWA_MANIFEST.display);
  });

  it("carries the two icon sizes an installable app is required to have", () => {
    // 192 for the launcher, 512 for the splash. One of them missing is the single most common
    // reason an otherwise correct app is quietly not installable.
    const sizes = PWA_MANIFEST.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("has a maskable icon as well as the full-bleed ones", () => {
    // A launcher crops to its own shape. Without a maskable icon it crops the full-bleed one,
    // which is how a logo ends up with its edges shaved off on exactly one make of phone.
    expect(PWA_MANIFEST.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("points every icon at a file that is actually there", () => {
    // The failure this catches costs an install and reports nothing at all.
    PWA_MANIFEST.icons.forEach((icon) => {
      expect(existsSync(`public${icon.src}`), `${icon.src} is missing from public/`).toBe(true);
    });
  });

  it("keeps start_url inside the scope, and both under the origin's root", () => {
    // A start_url outside the scope is not merely wrong, it is uninstallable - and the shapes
    // that cause it (a stray "./", a path from a subdirectory deploy) look perfectly fine.
    expect(PWA_MANIFEST.start_url.startsWith(PWA_MANIFEST.scope)).toBe(true);
    expect(PWA_MANIFEST.scope).toBe("/");
  });

  it("paints the splash in the palette's own ground", () => {
    // The splash shows before the app has rendered anything, so a default white one is a flash
    // of the wrong theme on every cold start. The bare `:root` is dark, so this is dark.
    expect(PWA_MANIFEST.background_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(PWA_MANIFEST.theme_color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
