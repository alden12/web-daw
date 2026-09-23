/**
 * The mark's colours and treatments, kept out of `BrandMark.tsx` so that file exports only a
 * component (react-refresh wants it that way, and the constants are shared with the generator's
 * output in `src/assets/logo/` regardless).
 *
 * These are literals rather than palette tokens on purpose. `--color-you` is live UI state twice
 * over - recolourable in Authors, re-lit for a white ground - and a logo that moves when someone
 * picks a different voice colour is not a logo. The bare treatment does follow `--color-brand`
 * when no hue is named, which is the one concession, and only because a single fixed colour
 * cannot be legible on both a near-black and a white ground.
 */

/** The hues the mark is drawn in. Trial set, to be cut down to the chosen one. */
export const LOGO_HUES = {
  teal: "#2a9d97",
  "deep-teal": "#17827d",
  "river-blue": "#1f6fa8",
  plum: "#6b4fc0",
} as const;

export type LogoHue = keyof typeof LOGO_HUES;

/**
 * - `mark`: the bare silhouette. Takes `--color-brand` unless a hue is named, so it follows the
 *   theme; the one to use where something else already supplies the surface.
 * - `disc`: white mark on a filled disc. Holds its shape against a background nobody chose, which
 *   is what a browser tab, a home screen and a launcher all are.
 * - `disc-inverted`: the hue on a white disc. Wants a mid-tone or dark ground - against a white
 *   one the disc vanishes and it quietly becomes `mark`.
 */
export type BrandTreatment = "mark" | "disc" | "disc-inverted";

export const BRAND_WHITE = "#ffffff";
