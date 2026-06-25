/**
 * A bar/beat ruler over a beat grid: bar numbers, beat ticks, the loop region
 * shaded between two draggable handles (loop start + loop end), and dimmed grid
 * beyond the loop on either side. Pure geometry from `timeGrid`, so the piano
 * roll and the arrangement timeline can share it. The handles report new values
 * continuously while dragging, so the caller's edit-log coalescing folds a drag
 * into one undo step.
 */
import { useRef } from "react";
import { beatTicks, beatToX, DEFAULT_BEATS_PER_BAR } from "./timeGrid";

const RULER_H = 22; // px

export function Ruler({
  viewBeats,
  loopStart,
  loopEnd,
  pxPerBeat,
  onSetLoopStart,
  onSetLoopEnd,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  minLoop = 1,
}: {
  /** Total beats drawn (loop end + trailing room to expand into). */
  viewBeats: number;
  loopStart: number;
  loopEnd: number;
  pxPerBeat: number;
  /** Omit to hide the loop-start handle (e.g. the piano roll, where clips start at 0). */
  onSetLoopStart?: (beats: number) => void;
  onSetLoopEnd: (beats: number) => void;
  beatsPerBar?: number;
  minLoop?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = beatToX(viewBeats, pxPerBeat);
  const ticks = beatTicks(viewBeats, beatsPerBar);

  // Shared loop-handle drag: snap to whole beats, clamp via the supplied limit fn.
  const drag = (e: React.PointerEvent, commit: (beats: number) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    const toBeats = (clientX: number) => Math.max(0, Math.round((clientX - left) / pxPerBeat));
    const onMove = (ev: PointerEvent) => commit(toBeats(ev.clientX));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={ref}
      className="sticky top-0 z-10 bg-rail border-b border-line select-none"
      style={{ width, height: RULER_H }}
    >
      {/* dim the area outside the loop region */}
      {loopStart > 0 && (
        <div className="absolute top-0 bottom-0 left-0 bg-black/30" style={{ width: beatToX(loopStart, pxPerBeat) }} />
      )}
      <div
        className="absolute top-0 bottom-0 bg-black/30"
        style={{ left: beatToX(loopEnd, pxPerBeat), width: beatToX(viewBeats - loopEnd, pxPerBeat) }}
      />

      {ticks.map((t) => (
        <div
          key={t.beat}
          className={`absolute top-0 bottom-0 ${t.isBar ? "bg-line" : "bg-line-soft"}`}
          style={{ left: beatToX(t.beat, pxPerBeat), width: 1 }}
        >
          {t.isBar && <span className="absolute left-1 top-0.5 font-mono text-[9px] text-faint">{t.bar}</span>}
        </div>
      ))}

      {/* loop start handle (only when the caller supports moving it) */}
      {onSetLoopStart && (
        <div
          role="slider"
          aria-label="Loop start"
          aria-valuenow={loopStart}
          title={`Loop start: beat ${loopStart} - drag to move`}
          onPointerDown={(e) => drag(e, (b) => onSetLoopStart(Math.min(b, loopEnd - minLoop)))}
          className="absolute top-0 bottom-0 w-2 -ml-1 cursor-ew-resize bg-you/70 hover:bg-you"
          style={{ left: beatToX(loopStart, pxPerBeat) }}
        />
      )}
      {/* loop end handle */}
      <div
        role="slider"
        aria-label="Loop length"
        aria-valuenow={loopEnd}
        title={`Loop end: beat ${loopEnd} (${loopEnd / beatsPerBar} bars) - drag to resize`}
        onPointerDown={(e) => drag(e, (b) => onSetLoopEnd(Math.max(b, loopStart + minLoop)))}
        className="absolute top-0 bottom-0 w-2 -ml-1 cursor-ew-resize bg-you/70 hover:bg-you"
        style={{ left: beatToX(loopEnd, pxPerBeat) }}
      />
    </div>
  );
}
