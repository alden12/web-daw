/**
 * The app's mark: a guitar in a canoe, going with the current.
 *
 * It replaced a conic-gradient orb built from `--color-you` / `--color-hot`, and the reason
 * that orb was wrong is the reason this component takes its colour from `--color-brand` and
 * nothing else. Those two are live UI state twice over: the user recolours them in Authors,
 * and light mode re-lights them for a white ground. Either one silently repaints the logo,
 * and a mark that moves with a preference is not a mark.
 *
 * `--color-brand` is the same teal `you` *defaults* to, so the mark still looks like the app
 * it opens. It just no longer follows it.
 *
 * The SVG arrives as text (`?raw`) rather than through `<img src>`, because `currentColor`
 * only resolves for inline SVG - an external file has no colour to inherit. It is a local
 * asset inlined at build time, so there is no untrusted markup here to sanitise.
 */
import markSvg from "../assets/corrente-logo.svg?raw";

/** Sized in px rather than by a class, since both callers want it bigger than the type around it. */
export function BrandMark({ size = 56 }: { size?: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="text-brand shrink-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: markSvg }}
    />
  );
}
