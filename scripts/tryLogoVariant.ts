/**
 * Point the favicon at one of the baked variants in `src/assets/logo/`, and regenerate the PNGs a
 * manifest and iOS need from it:
 *
 *   tsx scripts/tryLogoVariant.ts disc-plum
 *   tsx scripts/tryLogoVariant.ts mark-teal-outlined
 *
 * It began as the trial switcher - it used to rewrite `BrandMark`'s fallback treatment and hue too,
 * so a candidate could be looked at everywhere at once. Those constants became a per-theme pair that
 * a call site names for itself, which left this doing the half that is still worth having: a tab
 * icon is one file and one command away from any variant.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const variant = process.argv[2];
if (!variant) throw new Error("usage: tsx scripts/tryLogoVariant.ts <variant>, e.g. disc-river-blue");

const source = `src/assets/logo/${variant}.svg`;
const svg = readFileSync(source, "utf8").replace(
  /<!--[\s\S]*?-->/,
  `<!-- TRIAL: copied from ${source} by scripts/tryLogoVariant.ts. Rerun that with another variant\n     to swap it, and regenerate the PNGs beside it. -->`,
);
writeFileSync("public/favicon.svg", svg);
execFileSync("npx", ["tsx", "scripts/generateIcons.ts"], { stdio: "inherit" });

console.log(`\nfavicon: ${variant}`);
