/**
 * Rasterise `public/favicon.svg` into the PNGs a manifest and iOS need (MOBILE-3).
 *
 * Run by hand when the mark changes: `tsx scripts/generateIcons.ts`. Not part of the build,
 * because the source is a static file that changes about once a year and a build step that
 * launches a browser to redraw the same four images every time is a poor trade.
 *
 * It uses the Chromium that Playwright already ships rather than an image library, so nothing
 * joins the dependency tree for a job this rare.
 *
 * ## How big the mark is drawn, which is the only interesting part
 *
 * **Inscribed: the disc touches all four edges and is not clipped by any of them.** Both of the
 * obvious alternatives were tried and are worse.
 *
 * *Insetting it* to the 80% "safe zone" is the standard advice for a maskable icon, because a
 * launcher crops one to whatever shape it likes and the safe zone is what no crop can reach.
 * That advice is for a mark the crop could eat; **a mark already the shape of the crop has
 * nothing to lose**, and a circle inset inside a circular crop is a small circle in a thick
 * dark ring. That was the first attempt and a phone reported it as a black border.
 *
 * *Overshooting the edge* to avoid a hairline of ground under a mask that lands exactly on the
 * disc costs more than it saves: the overshoot is clipped by the image itself, so the disc
 * arrives at the launcher with four flat sides.
 *
 * Inscribed leaves ground only in the corners, where a circular crop never looks and a squircle
 * reads it as a frame. If those corners ever look wrong, the remaining option is to scale past
 * the diagonal (~1.42) so every mask crops into artwork and no ground can show at all - at the
 * price of the circle, whose silhouette goes with it.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

/** The palette's dark ground: what a squircle or rounded-square crop finds in the corners. */
const GROUND = "#0a0c0e";

const ICONS = [
  // The `any` icons are shown as-is rather than cropped, so they keep transparent corners and
  // whatever backdrop the surface puts behind them.
  { file: "public/icon-192.png", size: 192, background: "transparent" },
  { file: "public/icon-512.png", size: 512, background: "transparent" },
  { file: "public/icon-maskable-512.png", size: 512, background: GROUND },
  // iOS masks to a rounded square and composites on black, so it wants the same treatment as
  // maskable rather than the transparent one.
  { file: "public/apple-touch-icon.png", size: 180, background: GROUND },
];

const svg = readFileSync("public/favicon.svg", "utf8");
const browser = await chromium.launch();

for (const { file, size, background } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>
       html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${background};
                    display: flex; align-items: center; justify-content: center; overflow: hidden; }
       svg { width: ${size}px; height: ${size}px; flex: none; }
     </style>${svg}`,
  );
  writeFileSync(file, await page.screenshot({ omitBackground: background === "transparent" }));
  await page.close();
  console.log(`${file}  ${size}px  ${background}`);
}

await browser.close();
