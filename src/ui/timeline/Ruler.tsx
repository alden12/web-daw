/**
 * A bar/beat ruler over a beat grid: bar numbers, beat ticks, the loop region
 * shaded between two draggable handles (loop start + loop end), and dimmed grid
 * beyond the loop on either side. Pure geometry from `timeGrid`, so the piano
 * roll and the arrangement timeline can share it. The handles report new values
 * continuously while dragging, so the caller's edit-log coalescing folds a drag
 * into one undo step.
 */
import { useRef } from "react";
import { beatTicks, beatToX } from "./timeGrid";
import { DEFAULT_TIME_SIGNATURE, beatsPerBar as beatsPerBarOf } from "../../audio/project/schema";
import type { TimeSignature } from "../../audio/project/types";
import { beginPointerDrag } from "../pointerDrag";

const RULER_H = 22; // px

/**
 * A loop handle is a **2px bar you can see inside a box you can hit** (MOBILE-2, hit-target
 * floors). It used to be the bar and nothing else: 8px wide, which is a comfortable target
 * for a cursor and an almost impossible one for a finger.
 *
 * The box widens on a coarse pointer rather than for everyone, because the two handles can
 * sit `minLoop` apart - one beat - and at a low zoom that is fewer pixels than a finger is
 * wide. Overlapping targets are the price of a touch floor and are worth paying there; making
 * a mouse pay it too would swallow ruler clicks either side of every handle for no gain.
 *
 * `touch-none` on both, which is the other half of the defect: without it the scroll container
 * claims the gesture before the first move arrives, so on touch even a perfect hit did
 * nothing. `loopStart` had it and `loopEnd` never did.
 */
const HANDLE_HIT_AREA =
  "group absolute top-0 bottom-0 flex justify-center w-6 -ml-3 cursor-ew-resize touch-none " +
  "[@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-ml-[22px]";
const HANDLE_BAR = "w-2 h-full bg-you/70 group-hover:bg-you pointer-events-none";

export function Ruler({
  viewBeats,
  loopStart,
  loopEnd,
  pxPerBeat,
  onSetLoopStart,
  onSetLoopEnd,
  timeSignature = DEFAULT_TIME_SIGNATURE,
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
  timeSignature?: TimeSignature;
  minLoop?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = beatToX(viewBeats, pxPerBeat);
  const ticks = beatTicks(viewBeats, timeSignature);
  const beatsPerBar = beatsPerBarOf(timeSignature);

  // Shared loop-handle drag: snap to whole beats, clamp via the supplied limit fn.
  const drag = (e: React.PointerEvent, commit: (beats: number) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    const toBeats = (clientX: number) => Math.max(0, Math.round((clientX - left) / pxPerBeat));
    beginPointerDrag((ev) => commit(toBeats(ev.clientX)));
  };

  return (
    <div
      ref={ref}
      className="sticky top-0 z-10 bg-panel border-b border-line select-none"
      style={{ width, height: RULER_H }}
    >
      {/* dim the area outside the loop region */}
      {loopStart > 0 && (
        <div className="absolute top-0 bottom-0 left-0 bg-recess" style={{ width: beatToX(loopStart, pxPerBeat) }} />
      )}
      <div
        className="absolute top-0 bottom-0 bg-recess"
        style={{ left: beatToX(loopEnd, pxPerBeat), width: beatToX(viewBeats - loopEnd, pxPerBeat) }}
      />

      {ticks.map((tick) => (
        <div
          key={tick.beat}
          className={`absolute top-0 bottom-0 ${tick.isBar ? "bg-line" : "bg-line-soft"}`}
          style={{ left: beatToX(tick.beat, pxPerBeat), width: 1 }}
        >
          {tick.isBar && <span className="absolute left-1 top-0.5 font-mono text-[9px] text-faint">{tick.bar}</span>}
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
          className={HANDLE_HIT_AREA}
          style={{ left: beatToX(loopStart, pxPerBeat) }}
        >
          <span className={HANDLE_BAR} />
        </div>
      )}
      {/* loop end handle */}
      <div
        role="slider"
        aria-label="Loop length"
        aria-valuenow={loopEnd}
        title={`Loop end: beat ${loopEnd} (${loopEnd / beatsPerBar} bars) - drag to resize`}
        onPointerDown={(e) => drag(e, (b) => onSetLoopEnd(Math.max(b, loopStart + minLoop)))}
        className={HANDLE_HIT_AREA}
        style={{ left: beatToX(loopEnd, pxPerBeat) }}
      >
        <span className={HANDLE_BAR} />
      </div>
    </div>
  );
}
