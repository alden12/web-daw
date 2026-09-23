/**
 * The app's mark: a guitar in a canoe, going with the current.
 *
 * It replaced a conic-gradient orb built from `--color-you` / `--color-hot`, and the reason that
 * orb was wrong is the reason the bare treatment defaults to `--color-brand` and nothing else.
 * Those two are live UI state twice over: the user recolours them in Authors, and light mode
 * re-lights them for a white ground. Either one silently repaints the logo, and a mark that moves
 * with a preference is not a mark.
 *
 * The SVG arrives as text (`?raw`) rather than through `<img src>`, because `currentColor` only
 * resolves for inline SVG - an external file has no colour to inherit. It is a local asset inlined
 * at build time, so there is no untrusted markup here to sanitise. Inlining it is also what lets
 * the disc treatments below exist without a second copy of a 27KB path: they are the same markup
 * with a background, an inset and a stroke applied over it.
 *
 * The standalone files in `src/assets/logo/` are the same three treatments baked out for anything
 * that cannot run React - the favicon, a README, a slide. `scripts/generateLogoVariants.ts` writes
 * them, and its header is where the treatments are explained at length.
 */
import markSvg from "../assets/logo/mark.svg?raw";
import { BRAND_WHITE, LOGO_HUES, type BrandTreatment, type LogoHue } from "./brand";

/** How much of the 48-unit box the mark fills in a disc treatment, as the padding either side. */
const DISC_INSET = (48 - 38) / 2 / 48;

export function BrandMark({
  size = 56,
  treatment = "mark",
  hue,
}: {
  /** In px rather than a class, since callers generally want it bigger than the type around it. */
  size?: number;
  treatment?: BrandTreatment;
  /** Omitted on `mark` means `--color-brand`; the disc treatments need one and default to teal. */
  hue?: LogoHue;
}): React.ReactElement {
  const hueValue = hue ? LOGO_HUES[hue] : undefined;

  if (treatment === "mark") {
    return (
      <span
        aria-hidden="true"
        className={`${hueValue ? "" : "text-brand"} shrink-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:block`}
        style={{ width: size, height: size, color: hueValue }}
        dangerouslySetInnerHTML={{ __html: markSvg }}
      />
    );
  }

  const inverted = treatment === "disc-inverted";
  const disc = inverted ? BRAND_WHITE : (hueValue ?? LOGO_HUES.teal);
  const mark = inverted ? (hueValue ?? LOGO_HUES.teal) : BRAND_WHITE;

  return (
    <span
      aria-hidden="true"
      className="brand-mark-disc shrink-0 rounded-full block box-border [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
      style={{
        width: size,
        height: size,
        padding: size * DISC_INSET,
        background: disc,
        color: mark,
        // Read by `.brand-mark-disc` in index.css: the stroke is the *disc's* colour, not the
        // mark's, so it widens the holes in the path instead of thickening the shapes.
        ["--brand-disc" as string]: disc,
      }}
      dangerouslySetInnerHTML={{ __html: markSvg }}
    />
  );
}
