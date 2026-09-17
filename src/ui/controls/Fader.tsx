/**
 * A horizontal fader: a track you drag along, with the value read out beside it.
 *
 * **It works in normalised 0..1 and knows nothing about units.** The parameter faders sit
 * behind a taper (a filter cutoff is logarithmic, so halfway along the track is not halfway
 * between min and max), and a note's velocity is already a fraction. Keeping the conversion
 * outside means neither has to pretend to be the other, and this stays presentation.
 *
 * ## Pressing sets the value
 *
 * Rather than starting a relative drag from wherever the value happens to be. On a track that
 * spans the whole range, the position under your finger *is* a value, and a control that
 * ignores a tap is a control that looks broken on a phone. (This is a change for the drum
 * panel's rows, which previously only responded to a drag.)
 *
 * ## The hit area is not the track
 *
 * The track is 8px tall, which is a comfortable target for a cursor and no target at all for a
 * finger. A transparent child stretches the catchment well past it without changing the layout
 * around it, so a row stays the height it was drawn at. Same trick as the roll's note handles.
 */
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "../../util";

/** How far an arrow key moves it: twenty steps end to end, which is fine for every current use. */
const KEY_STEP = 0.05;

export function Fader({
  label,
  position,
  onPosition,
  display,
  aria,
  fillStyle,
  className = "",
}: {
  /** Names the control for assistive tech. The visible label, if any, is the caller's. */
  label: string;
  /** Where along the track, 0..1. */
  position: number;
  onPosition: (position: number) => void;
  /** The value in the caller's own units, shown at the right end. */
  display?: string;
  /** Announced values, in those same units - 0..1 is not what a screen reader wants. */
  aria: { now: number; min: number; max: number };
  /** Paints the filled part, so a parameter can carry its last editor's colour. */
  fillStyle?: CSSProperties;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const positionAt = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    return box?.width ? clamp((clientX - box.left) / box.width, 0, 1) : position;
  };
  const nudge = (delta: number) => onPosition(clamp(position + delta, 0, 1));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    onPosition(positionAt(event.clientX));
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) onPosition(positionAt(event.clientX));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragging.current = false;
  };

  // Arrow keys, Home and End, which is what `role="slider"` promises a keyboard user.
  const KEYS: Record<string, () => void> = {
    ArrowRight: () => nudge(KEY_STEP),
    ArrowUp: () => nudge(KEY_STEP),
    ArrowLeft: () => nudge(-KEY_STEP),
    ArrowDown: () => nudge(-KEY_STEP),
    Home: () => onPosition(0),
    End: () => onPosition(1),
  };

  return (
    <div className={`flex flex-1 items-center gap-2 min-w-0 ${className}`}>
      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuenow={aria.now}
        aria-valuemin={aria.min}
        aria-valuemax={aria.max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(event) => {
          const handler = KEYS[event.key];
          if (!handler) return;
          event.preventDefault();
          handler();
        }}
        className="relative flex-1 h-2 rounded-full bg-ground border border-line cursor-ew-resize touch-none focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-2"
      >
        {/* The catchment. Absolute, so growing it moves nothing around it. */}
        <span className="absolute inset-x-0 -inset-y-3 [@media(pointer:coarse)]:-inset-y-5" />
        <span
          className="absolute left-0 top-0 bottom-0 rounded-full pointer-events-none"
          style={{ ...fillStyle, width: `${position * 100}%` }}
        />
        <span
          className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-line bg-card shadow pointer-events-none [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-2"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      {display !== undefined && (
        <span className="w-11 shrink-0 text-right font-mono text-[10px] text-ink tabular-nums">{display}</span>
      )}
    </div>
  );
}
