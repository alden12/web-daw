/**
 * A bar/beat ruler over a beat grid: bar numbers, beat ticks, and a draggable
 * loop-end handle that sets the loop length (snapped to whole beats). Pure
 * geometry from `timeGrid`, so the piano roll and the arrangement timeline can
 * share it. The handle reports the new length continuously while dragging
 * (`onSetLength`), so the caller's edit-log coalescing folds the drag into one
 * undo step.
 */
import { useRef } from 'react';
import { beatTicks, beatToX, DEFAULT_BEATS_PER_BAR } from './timeGrid';

const RULER_H = 22; // px

export function Ruler({
  lengthBeats,
  pxPerBeat,
  onSetLength,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  minBeats = 1,
}: {
  lengthBeats: number;
  pxPerBeat: number;
  onSetLength: (beats: number) => void;
  beatsPerBar?: number;
  minBeats?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = beatToX(lengthBeats, pxPerBeat);
  const ticks = beatTicks(lengthBeats, beatsPerBar);

  const startLoopDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    const toBeats = (clientX: number) => Math.max(minBeats, Math.round((clientX - left) / pxPerBeat));
    const onMove = (ev: PointerEvent) => onSetLength(toBeats(ev.clientX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={ref}
      className="sticky top-0 z-10 bg-rail border-b border-line select-none"
      style={{ width, height: RULER_H }}
    >
      {ticks.map((t) => (
        <div
          key={t.beat}
          className={`absolute top-0 bottom-0 ${t.isBar ? 'bg-line' : 'bg-line-soft'}`}
          style={{ left: beatToX(t.beat, pxPerBeat), width: 1 }}
        >
          {t.isBar && (
            <span className="absolute left-1 top-0.5 font-mono text-[9px] text-faint">{t.bar}</span>
          )}
        </div>
      ))}

      {/* Loop-end handle: drag to set the loop length. */}
      <div
        role="slider"
        aria-label="Loop length"
        aria-valuenow={lengthBeats}
        title={`Loop: ${lengthBeats} beats (${lengthBeats / beatsPerBar} bars) - drag to resize`}
        onPointerDown={startLoopDrag}
        className="absolute top-0 bottom-0 w-2 -ml-1 cursor-ew-resize bg-you/70 hover:bg-you"
        style={{ left: width }}
      />
    </div>
  );
}
