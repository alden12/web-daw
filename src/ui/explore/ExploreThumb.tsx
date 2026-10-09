/**
 * The artwork for an Explore item or category: the category's hue as a gradient, and on it the
 * item's sound portrait (COMM-1.9.2) - or, for what has none yet (your patches, samples), the
 * category's glyph. A nudge of hue per name keeps a list of one category from reading as a single
 * repeated tile.
 */
import type { ReactNode } from "react";
import { CATEGORIES, type ExploreCategory } from "./exploreItems";
import type { Portrait } from "../../audio/portraits/draw";

const GLYPHS: Record<ExploreCategory, ReactNode> = {
  favourites: <path d="M8 13.2s-5-3.1-6.1-6A3.1 3.1 0 0 1 8 4.4a3.1 3.1 0 0 1 6.1 2.8C13 10.1 8 13.2 8 13.2z" />,
  instruments: (
    <>
      <rect x="2.5" y="4" width="11" height="8" rx="1" />
      <path d="M6 4v4M8 4v4M10 4v4" />
    </>
  ),
  patches: <path d="M4 2.5h8v11l-4-2.5-4 2.5z" />,
  effects: (
    <>
      <path d="M3 5h10M3 8h10M3 11h10" />
      <circle cx="6" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  midi: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5 8h.01M6 5.6h.01M8 4.8h.01M10 5.6h.01M11 8h.01" strokeWidth="1.8" />
    </>
  ),
  samples: <path d="M2 8h1.5M4.5 5v6M6.5 3v10M8.5 5.5v5M10.5 4v8M12.5 6.5v3M14 8h.5" />,
};

/** A small, stable spread of hue per name: enough to tell neighbours apart, not enough to recolour. */
const hueShift = (seed: string) =>
  ([...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % 41) - 20;

export function ExploreThumb({
  category,
  seed = "",
  portrait,
  size,
}: {
  category: ExploreCategory;
  seed?: string;
  /** The item's sound portrait, drawn in place of the glyph when there is one (COMM-1.9.2). */
  portrait?: Portrait;
  size: number;
}) {
  const hue = CATEGORIES[category].hue + hueShift(seed);
  return (
    <span
      aria-hidden="true"
      className="shrink-0 flex items-center justify-center rounded-md text-white/85"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, hsl(${hue} 46% 42%), hsl(${hue + 40} 50% 20%))`,
      }}
    >
      {portrait ? (
        // A soft glow, as on a scope's screen. `non-scaling-stroke`, so a 40px row and a 96px header
        // draw the same weight of line.
        <svg viewBox="0 0 100 100" className="w-full h-full [filter:drop-shadow(0_0_2px_rgb(255_255_255/0.45))]">
          {portrait.fill && <path d={portrait.fill} fill="currentColor" fillOpacity={0.9} />}
          {portrait.line && (
            <path
              d={portrait.line}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: size * 0.48, height: size * 0.48 }}
        >
          {GLYPHS[category]}
        </svg>
      )}
    </span>
  );
}
