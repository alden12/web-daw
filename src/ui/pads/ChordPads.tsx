/**
 * The chord pads (MOBILE-12): a column per degree, its triad at the bottom and its variations
 * stacked above in the order they are arranged. A degree with fewer variations than there are rows
 * leaves a gap rather than borrowing a chord from outside the key.
 *
 * **The base row stays put and the variations scroll.** `+`/`-` say how many rows are on show; the
 * rest are a scroll away, so an odd chord is reachable without rearranging anything. The pads cannot
 * be the scroll handle - a drag down on one is the sustain latch - so each row leaves a strip down
 * its right edge that is not a pad, and a drag there scrolls natively, with the rail drawn over it
 * saying where you are. A wheel or trackpad scrolls from anywhere.
 *
 * **Editing** (`settings.editingChords`) lays out hidden chords too, dimmed, and turns a tap into
 * a selection for `ChordEditBar`; the pads stop sounding and wear a dashed edge so that is plain.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { chordRows, type ChordPad } from "../../audio/theory/chords";
import { PAD_HEIGHT, rowGap } from "./geometry";
import type { PadSettings } from "./padSettings";
import { PadButton } from "./PadButton";
import type { PadTouch } from "./usePadTouch";

/** The strip down each row's right edge that scrolls rather than plays. Wide enough for a thumb. */
export const SCROLL_STRIP = 20;
/** Chord rows abut the way note rows do with the accidentals off, so they take the same wide gap. */
const GAP = rowGap(false);

export function ChordPads({ settings, touch }: { settings: PadSettings; touch: PadTouch }) {
  const { tonic, scale, lowOctave, chordRows: shown, chordPrefs: prefs, editingChords: editing } = settings;
  const [base, ...above] = chordRows({ tonic, scale, lowOctave, prefs, editing });
  const scrolling = Math.min(shown - 1, above.length);

  const row = (pads: (ChordPad | null)[], rowIndex: number) => (
    <div
      key={rowIndex}
      data-chord-row={rowIndex}
      className="shrink-0 flex gap-1 snap-end"
      style={{ height: PAD_HEIGHT, marginRight: SCROLL_STRIP }}
    >
      {pads.map((chord, column) =>
        chord ? (
          <PadButton
            key={column}
            pitches={chord.pitches}
            name={chord.name}
            label={chord.name}
            sublabel={chord.favourite ? `★ ${chord.caption}` : chord.caption}
            // A chord reaching outside the key sits back the way an accidental does, so you can see
            // you are leaving the key before you hear it.
            tone={
              chord.favourite
                ? "favourite"
                : chord.outside
                  ? "accidental"
                  : rowIndex === 0 && chord.degree === 0
                    ? "tonic"
                    : "in-scale"
            }
            touch={touch}
            className="flex-1 min-w-0"
            editing={
              editing
                ? {
                    onSelect: () => settings.setChordSelection({ degree: chord.degree, family: chord.family }),
                    selected:
                      settings.chordSelection?.degree === chord.degree &&
                      settings.chordSelection.family === chord.family,
                    hidden: chord.hidden,
                  }
                : undefined
            }
          />
        ) : (
          <div key={column} className="flex-1 min-w-0" />
        ),
      )}
    </div>
  );

  return (
    <div className="shrink-0 flex flex-col px-2 pb-2" style={{ gap: GAP }}>
      {scrolling > 0 && (
        <ScrollingRows height={scrolling * PAD_HEIGHT + (scrolling - 1) * GAP}>
          {above.map((pads, index) => row(pads, index + 1))}
        </ScrollingRows>
      )}
      {row(base, 0)}
    </div>
  );
}

/**
 * The rows above the base, scrolled from the bottom: the row nearest the triads shows first, as the
 * stack reads upwards. Snapping to whole rows so a scroll never leaves one cut in half.
 */
function ScrollingRows({ height, children }: { height: number; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; size: number } | null>(null);

  const measure = () => {
    const element = scroller.current;
    if (!element) return;
    const { scrollHeight, clientHeight, scrollTop } = element;
    const next =
      scrollHeight <= clientHeight + 1
        ? null
        : // Column-reverse scrolls with a scrollTop of 0 at the bottom and negative above it.
          {
            size: clientHeight / scrollHeight,
            top:
              ((scrollHeight - clientHeight + scrollTop) / (scrollHeight - clientHeight)) *
              (1 - clientHeight / scrollHeight),
          };
    // Measured after every render, so only a real change may set state - or it renders forever.
    setThumb((previous) => (previous?.top === next?.top && previous?.size === next?.size ? previous : next));
  };
  useLayoutEffect(measure);

  return (
    <div className="relative shrink-0" style={{ height }}>
      <div
        ref={scroller}
        data-chord-scroll
        onScroll={measure}
        className="h-full overflow-y-auto overscroll-contain snap-y snap-mandatory flex flex-col-reverse [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ gap: GAP }}
      >
        {children}
      </div>
      {thumb && (
        <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 right-1.5 w-1 rounded-full bg-control">
          <div
            className="absolute left-0 right-0 rounded-full bg-muted"
            style={{ top: `${thumb.top * 100}%`, height: `${thumb.size * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
