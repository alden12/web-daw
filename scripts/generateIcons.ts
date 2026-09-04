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
 * ## The scales, which are the only interesting part
 *
 * A **maskable** icon is cropped by the launcher to whatever shape it likes: a circle, a
 * squircle, a rounded square. The usual advice is to inset the mark to the 80% "safe zone" so
 * no crop can clip it, and that was the first attempt here. It looks wrong, and a phone said
 * so: a circular mark inset inside a circular crop is a small circle in a thick dark ring.
 *
 * The inset exists to stop a crop eating the artwork. **A mark that is already the crop's shape
 * has nothing to lose**, so this one is drawn a whisker past the square's edge instead. A
 * circular mask then crops exactly at the disc and the icon fills it edge to edge; a squircle
 * reaches into the corners and finds the ground, which reads as a frame rather than a mistake.
 *
 * Slightly past rather than exactly on the edge, because an antialiased edge landing precisely
 * on the crop leaves a hairline of ground all the way round.
 *
 * The alternative, if the corners ever look wrong, is to scale past the diagonal (~1.42) so
 * every mask crops into artwork. That can never show ground, at the price of the circle: the
 * silhouette goes, and the icon becomes a gradient in the launcher's own shape.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

/** Just past the square's edge, so no crop leaves a hairline of ground around the disc. */
const BLEED = 1.06;
/** The palette's dark ground: what a squircle or rounded-square crop finds in the corners. */
const GROUND = "#0a0c0e";

const ICONS = [
  // The `any` icons are shown as-is rather than cropped, so they keep transparent corners and
  // whatever backdrop the surface puts behind them.
  { file: "public/icon-192.png", size: 192, scale: 1, background: "transparent" },
  { file: "public/icon-512.png", size: 512, scale: 1, background: "transparent" },
  { file: "public/icon-maskable-512.png", size: 512, scale: BLEED, background: GROUND },
  // iOS masks to a rounded square and composites on black, so it wants the same treatment as
  // maskable rather than the transparent one.
  { file: "public/apple-touch-icon.png", size: 180, scale: BLEED, background: GROUND },
];

const svg = readFileSync("public/favicon.svg", "utf8");
const browser = await chromium.launch();

for (const { file, size, scale, background } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const mark = Math.round(size * scale);
  await page.setContent(
    `<style>
       html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${background};
                    display: flex; align-items: center; justify-content: center; overflow: hidden; }
       svg { width: ${mark}px; height: ${mark}px; flex: none; }
     </style>${svg}`,
  );
  writeFileSync(file, await page.screenshot({ omitBackground: background === "transparent" }));
  await page.close();
  console.log(`${file}  ${size}px  mark ${mark}px  ${background}`);
}

await browser.close();
