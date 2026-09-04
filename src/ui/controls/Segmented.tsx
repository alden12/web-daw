/**
 * A segmented control: pick one of a few, all visible at once.
 *
 * Worth having as its own thing because the app is full of choices that *are* a group and are
 * currently drawn as loose buttons that happen to sit near each other (snap division, zoom,
 * the Melodic/Drums switch, the drum editor's Keys/Pads). Grouping them says "these are the
 * options, and this is the one you are on" in the markup as well as the paint: one shared
 * border, `role="radiogroup"`, arrow keys.
 *
 * Two or three short options. More than that wants a select, which does not ask the layout to
 * grow with the vocabulary.
 */
import { CONTROL_BASE, TONE_ACTIVE, type Tone } from "./tone";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Tooltip, when the label has been shortened to fit. */
  title?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "you",
  label,
  className = "",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tone?: Tone;
  /** Names the group for assistive tech: "Snap division", not the chosen option. */
  label: string;
  className?: string;
}) {
  // Arrow keys move between options the way a radio group is expected to, wrapping at both
  // ends. Tab moves past the whole group rather than through it.
  const step = (from: T, delta: number) => {
    const index = options.findIndex((option) => option.value === from);
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      // Softly rounded rather than a pill: a group of options reads as one boxed set, and
      // fully round ends make the two outer segments a different shape from any inner one.
      className={`inline-flex rounded-md border border-line overflow-hidden bg-control ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title ?? option.label}
            // Only the selected option is tabbable, so the group is one stop and the arrows
            // do the choosing. Standard radio-group behaviour.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") step(option.value, 1);
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(option.value, -1);
            }}
            className={`${CONTROL_BASE} h-7 px-2.5 text-[11.5px] rounded-none border-y-0 border-x-0 ${
              selected ? TONE_ACTIVE[tone] : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
