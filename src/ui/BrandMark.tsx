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
 * every treatment below exist without another copy of a 27KB path: they are the same markup with
 * a background, an inset and a stroke applied over it.
 *
 * The standalone files in `src/assets/logo/` are these same treatments baked out for anything that
 * cannot run React - the favicon, a README, a slide. `scripts/generateLogoVariants.ts` writes
 * them, and its header is where the treatments are explained at length.
 */
import markSvg from "../assets/logo/mark.svg?raw";
import {
  BRAND_TREATMENT,
  BRAND_WHITE,
  LOGO_HUES,
  type BrandTreatment,
  type BrandTreatmentPair,
  type LogoHue,
} from "./brand";
import { useResolvedTheme } from "./theme";

/**
 * What each treatment paints, in the baked variants' units. Each colour slot names a source rather
 * than a value - "hue" is whichever hue the caller or the theme supplies, "white" is white, "disc"
 * means "whatever fills the circle" - so the table reads as intent and the component resolves it
 * once. `wash` and `edge` are the two pieces CSS has to draw instead, because both are mixed from
 * `--color-ink` and only CSS knows which theme is live.
 *
 * `span` is how much of the 48-unit box the mark fills, and it is smaller wherever a treatment
 * needs room: that difference becomes padding on the wrapper, and the inlined SVG is given
 * `overflow-visible` so a stroke can paint into it. The master's viewBox is the path's own bounding
 * box, which leaves a stroke nothing to spill into - without both halves of this the outlined mark
 * loses its halo to the viewBox edge. The outline reaches about 2 of the 48 units past the path,
 * hence 43; a disc wants its edge clear, hence 38; a ring or a chip wants clearance from a line
 * drawn at that edge, hence 34.
 */
type Paint = "hue" | "white";

const TREATMENTS: Record<
  BrandTreatment,
  { span: number; disc: Paint | null; mark: Paint; stroke: Paint | "disc"; edge: boolean }
> = {
  // A disc strokes the mark in the disc's own colour, which widens the holes in the path rather
  // than thickening the shapes - the trick that keeps the canoe reading as a canoe at 16px.
  disc: { span: 38, disc: "hue", mark: "white", stroke: "disc", edge: true },
  // The mark painted the disc's own colour, so the fill vanishes into it and only the white stroke
  // is left: line art rather than a silhouette.
  "disc-outline": { span: 34, disc: "hue", mark: "hue", stroke: "white", edge: true },
  "mark-outlined": { span: 43, disc: null, mark: "hue", stroke: "white", edge: false },
};

export function BrandMark({
  size = 56,
  treatment = BRAND_TREATMENT,
  hue = "plum",
}: {
  /** In px rather than a class, since callers generally want it bigger than the type around it. */
  size?: number;
  /** One treatment, or one per ground. Defaults to `BRAND_TREATMENT`, which is a pair. */
  treatment?: BrandTreatment | BrandTreatmentPair;
  /** The mark ships in one hue; the parameter is here so the generator and the app agree. */
  hue?: LogoHue;
}): React.ReactElement {
  const theme = useResolvedTheme();
  const spec = TREATMENTS[typeof treatment === "string" ? treatment : treatment[theme]];
  const hueValue = LOGO_HUES[hue];
  const paint = (source: Paint) => (source === "hue" ? hueValue : BRAND_WHITE);

  const disc = spec.disc ? paint(spec.disc) : undefined;
  const stroke = spec.stroke === "disc" ? disc : paint(spec.stroke);

  return (
    <span
      aria-hidden="true"
      className={`brand-mark-stroked ${spec.edge ? "brand-mark-edge rounded-full" : ""} shrink-0 block box-border [&>svg]:w-full [&>svg]:h-full [&>svg]:block [&>svg]:overflow-visible`}
      style={{
        width: size,
        height: size,
        padding: (size * (48 - spec.span)) / 2 / 48,
        background: disc,
        color: paint(spec.mark),
        // Read by `.brand-mark-stroked` in index.css, which cannot reach an inline style directly.
        ["--brand-stroke" as string]: stroke,
      }}
      dangerouslySetInnerHTML={{ __html: markSvg }}
    />
  );
}
