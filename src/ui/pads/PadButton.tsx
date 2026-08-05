/**
 * One pad (MOBILE-6). Shared by the scale pads and a kit's own pads so a press, a chord
 * and a latch look the same wherever you are playing.
 *
 * `touch-action: none` is not decoration: without it the browser claims the vertical drag
 * for scrolling before the first move event arrives, and the sustain gesture never happens.
 */
import type { CSSProperties, ReactNode } from "react";
import type { PadTouch } from "./usePadTouch";

const TONE_CLASS = {
  /** The tonic reads as home without shouting: the same pad, tinted. */
  tonic: "bg-card text-you border-you/30",
  "in-scale": "bg-card text-ink border-line",
  /** Out of the scale, so it sits back the way a black key does. */
  accidental: "bg-ground text-muted border-line",
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
      className={`flex flex-col items-center justify-center leading-none touch-none select-none cursor-pointer ${
        sounding ? "bg-you/25 text-you border-you/60" : TONE_CLASS[tone]
      } ${latched ? "ring-1 ring-inset ring-you" : ""} ${className}`}
      style={style}
    >
      <span className="font-mono text-[12px] font-semibold">{label}</span>
      {sublabel && <span className="mt-0.5 font-mono text-[9px] text-faint">{sublabel}</span>}
    </button>
  );
}
