/**
 * Rasterise the app icon into the PNGs a manifest and iOS need (MOBILE-3).
 *
 * **The source is not `public/favicon.svg`, and that is deliberate.** A tab draws its icon at 16px
 * and a home screen draws this one at 192 or more, which is a big enough gap that they want
 * different drawings of the same mark: the favicon is the outlined silhouette and these are the
 * plum disc with the mark drawn as white line art. One mark, a treatment
 * per size, rather than one file stretched across both.
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
 * **Two treatments, by whether the surface crops.**
 *
 * *Shown as-is* (`any`): the disc inscribed in the square, transparent corners. Nothing crops it, so
 * the disc is the shape.
 *
 * *Cropped by the launcher* (`maskable`, and iOS): **the whole square is plum and the mark sits in the
 * middle**, so whatever shape the launcher cuts - circle, squircle, rounded square - becomes the disc.
 * This used to be the inscribed disc on the dark ground, on the argument that a circle has nothing to
 * lose to a circular crop. It does: a launcher does not crop at the disc's edge but zooms in past it.
 * The web spec only promises the middle 80% survives, and Android's adaptive icons keep nearer 61% -
 * so on a phone the artwork, which filled 79% of the image, lost its edges. Sizing the ARTWORK to the
 * safe zone, rather than the disc, is what the safe zone is actually about.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

/** The disc colour, which fills a cropped icon edge to edge so the launcher's shape becomes the disc. */
const PLUM = "#6b4fc0";

/**
 * How much of a cropped icon's width the artwork spans. Android's adaptive-icon safe zone is about
 * 61% (66 of 108dp), and the mark is roughly as tall as it is wide, so this keeps its corners inside
 * a circular crop with a little air.
 */
const ART_FRACTION = 0.5;

/** How much of the source SVG's width its artwork spans (the outline disc draws it 34 units of 48). */
const SOURCE_ART_FRACTION = 34 / 48;

const ICONS = [
  // Shown as-is rather than cropped: the disc, with transparent corners.
  { file: "public/icon-192.png", size: 192, cropped: false },
  { file: "public/icon-512.png", size: 512, cropped: false },
  // Cropped to the launcher's shape: plum edge to edge, the mark inside the safe zone. iOS masks to a
  // rounded square and composites on black, so it wants the same.
  { file: "public/icon-maskable-512.png", size: 512, cropped: true },
  { file: "public/apple-touch-icon.png", size: 180, cropped: true },
];

/** The treatment the app icon wears, from the baked set (`scripts/generateLogoVariants.ts`). */
const APP_ICON = "src/assets/logo/disc-plum-outline.svg";

const svg = readFileSync(APP_ICON, "utf8");
const browser = await chromium.launch();

for (const { file, size, cropped } of ICONS) {
  const drawn = cropped ? Math.round((size * ART_FRACTION) / SOURCE_ART_FRACTION) : size;
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>
       html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${cropped ? PLUM : "transparent"};
                    display: flex; align-items: center; justify-content: center; overflow: hidden; }
       svg { width: ${drawn}px; height: ${drawn}px; flex: none; }
     </style>${svg}`,
  );
  writeFileSync(file, await page.screenshot({ omitBackground: !cropped }));
  await page.close();
  console.log(`${file}  ${size}px  ${cropped ? "cropped" : "as-is"}`);
}
await browser.close();
