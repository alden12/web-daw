/**
 * The mark's colour and treatments, kept out of `BrandMark.tsx` so that file exports only a
 * component (react-refresh wants it that way, and these are shared with the generator's output in
 * `src/assets/logo/` regardless).
 *
 * The hue is a literal rather than a palette token on purpose. `--color-you` and `--color-agent`
 * are live UI state twice over - recolourable in Authors, re-lit for a white ground - and a logo
 * that moves when someone picks a different voice colour is not a logo.
 */

/**
 * The mark's plum. It is one shade off `--color-agent`, which is deliberate rather than sloppy:
 * matching them exactly would mean either a washed-out logo or an illegible author colour. An
 * author colour has to clear 4.5:1 on the near-black ground (`test/oklch.test.ts` enforces it), and
 * this plum measures 3.27:1, so the palette carries a lighter cousin of it and the mark keeps the
 * weight it was drawn with. They sit close enough to read as one family and never appear together.
 */
export const LOGO_HUES = { plum: "#6b4fc0" } as const;

export type LogoHue = keyof typeof LOGO_HUES;

/**
 * - `disc`: white mark on a filled disc. One confident shape, which is what a surface nobody chose
 *   needs - a light frame, a home screen, a launcher.
 * - `disc-outline`: the same disc with the artwork painted the disc's own colour, so its fill
 *   vanishes and only the white stroke survives. Line art rather than a silhouette, which reads as
 *   the more detailed object but needs a dark surround and about 32px to work.
 * - `mark-outlined`: no disc, the silhouette with the white sticker halo the trace shipped with.
 *   The favicon's, because at 16px a disc's line art closes into a smudge and a halo does not.
 *
 * Treatments the trial tried and dropped, in case the ground shifts: the bare mark in
 * `--color-brand`; the disc inverted (white disc, coloured mark), which disappears against white;
 * a white ring with nothing inside it; and a translucent ink chip. `git log` has them.
 */
export type BrandTreatment = "disc" | "disc-outline" | "mark-outlined";

/**
 * A treatment per ground, for a placement whose answer differs between them - which most of them
 * turn out to be. The dark frame and the white one are different enough surfaces that the same
 * object rarely works on both: what lifts off near-black sinks into white, and vice versa.
 */
export type BrandTreatmentPair = Record<"dark" | "light", BrandTreatment>;

/**
 * What the mark wears everywhere it appears in the app, and the answer a long trial arrived at:
 * line art on a plum disc against the dark frame, the filled disc against the light one. The dark
 * ground gives white strokes something to be white against; the light one does not, so there the
 * silhouette does the work instead. Either way it is a disc, so every placement is the same object.
 *
 * The favicon is the exception and is not drawn by this component at all - see
 * `scripts/generateIcons.ts` for why a 16px tab wants a different treatment from everything else.
 */
export const BRAND_TREATMENT: BrandTreatmentPair = { dark: "disc-outline", light: "disc" };

export const BRAND_WHITE = "#ffffff";
