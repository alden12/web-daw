/**
 * One pad (MOBILE-6). Shared by the scale pads and a kit's own pads so a press, a chord
 * and a latch look the same wherever you are playing.
 *
 * `touch-action: none` is not decoration: without it the browser claims the vertical drag
 * for scrolling before the first move event arrives, and the sustain gesture never happens.
 */
import type { CSSProperties, ReactNode } from "react";
import type { PadTouch } from "./usePadTouch";

/**
 * Fill, not outline. Every pad wears the same grey and they are separated by the gaps between
 * them rather than by borders, which is what makes a bank read as a row of keys instead of a
 * grid with lines ruled through it. What differs per tone is the *label* colour, so the pads
 * stay one object and the tonic still says where home is.
 */
const TONE_CLASS = {
  /** The tonic reads as home without shouting: the same pad, its label tinted. */
  tonic: "bg-control text-you",
  "in-scale": "bg-control text-ink",
  /** Out of the scale, so it sits back the way a black key does. */
  accidental: "bg-control text-muted",
} as const;

export function PadButton({
  name,
  label,
  sublabel,
  tone = "in-scale",
  touch,
  pitch,
  className = "",
  style,
}: {
  /** What it is, for the accessibility tree and for tests: a note name, or a kit pad's sample. */
  name: string;
  /** The big glyph - an interval, or a kit pad's number. */
  label: ReactNode;
  /** The quiet one beneath it. */
  sublabel?: string;
  tone?: keyof typeof TONE_CLASS;
  touch: PadTouch;
  pitch: number;
  className?: string;
  style?: CSSProperties;
}) {
  const sounding = touch.isSounding(pitch);
  const latched = touch.isLatched(pitch);
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={sounding}
      data-pitch={pitch}
      {...touch.padProps(pitch)}
      // No position utility here: the accidentals position themselves absolutely, and two
      // Tailwind classes for the same property are settled by stylesheet order rather than
      // by which one the caller passed - so the base class would win at random.
      //
      // The radius *is* here, because every pad everywhere has the same one; only size and
      // position are the caller's business.
      className={`flex flex-col items-center justify-center rounded-md leading-none touch-none select-none cursor-pointer transition-colors ${
        sounding ? "bg-you/30 text-you" : TONE_CLASS[tone]
      } ${latched ? "ring-1 ring-inset ring-you" : ""} ${className}`}
      style={style}
    >
      <span className="font-mono text-[12px] font-semibold">{label}</span>
      {sublabel && <span className="mt-0.5 font-mono text-[9px] text-faint">{sublabel}</span>}
    </button>
  );
}
