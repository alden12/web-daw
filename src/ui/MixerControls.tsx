/**
 * Shared mixer controls for the track/group headers: a low-profile Fader (a thin track
 * with the accent as its filled portion and a small ring handle) and an adjoined
 * Mute/Solo button pair. The Fader is built to host a live level meter later - it
 * already accepts an optional `level` (0..1) and `clip` and renders a meter bar behind
 * the track (red when clipping); callers just don't pass them yet (per-bus metering is
 * DAW-8.5).
 */
import { useRef } from "react";

export function Fader({
  value,
  onChange,
  title,
  width = 56,
  max = 1,
  level,
  clip = false,
  onPointerDownCapture,
}: {
  value: number;
  onChange: (v: number) => void;
  title?: string;
  width?: number;
  /** Top of the range (default 1). Clip gain uses >1 to allow a boost. */
  max?: number;
  /** Live output level 0..1 for the meter overlay (omitted = no meter yet). */
  level?: number;
  /** Clipping (>= 0 dBFS): the meter turns red. */
  clip?: boolean;
  onPointerDownCapture?: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frac = Math.min(1, Math.max(0, value / max));
  const step = max * 0.05;

  const setFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(Math.min(max, Math.max(0, ((clientX - r.left) / r.width) * max)));
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={title}
      aria-valuenow={Math.round(frac * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title={title}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons) setFromClientX(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0, value - step));
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, value + step));
      }}
      className="relative h-4 shrink-0 cursor-pointer select-none touch-none"
      style={{ width }}
    >
      {/* Meter overlay (future): a level bar behind the line, red when clipping. */}
      {level !== undefined && (
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-sm ${clip ? "bg-claude" : "bg-good/70"}`}
          style={{ width: `${Math.min(1, Math.max(0, level)) * 100}%` }}
        />
      )}
      {/* The track, and the accent as the filled portion - the same rule the knobs and the
          device faders follow, so the three read as one family. */}
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-line" />
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-you"
        style={{ width: `${frac * 100}%` }}
      />
      {/* A 9px ring handle. Small on purpose: the row is 46px tall and the name has to fit
          beside it. The hit area is the whole 16px-tall track, not this. */}
      <div
        className="absolute top-1/2 w-2.25 h-2.25 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-you bg-panel"
        style={{ left: `${frac * 100}%` }}
      />
    </div>
  );
}

export function MuteSolo({
  muted,
  solo,
  onMute,
  onSolo,
}: {
  muted: boolean;
  solo: boolean;
  onMute: () => void;
  onSolo: () => void;
}) {
  const btn = "font-mono text-[10px] leading-none w-5 h-6 cursor-pointer";
  return (
    <div className="flex shrink-0 rounded-md border border-line overflow-hidden">
      <button
        type="button"
        title={muted ? "Unmute" : "Mute"}
        onClick={(e) => {
          e.stopPropagation();
          onMute();
        }}
        className={`${btn} ${muted ? "bg-claude/20 text-claude" : "bg-card text-ink hover:text-strong"}`}
      >
        M
      </button>
      <button
        type="button"
        title={solo ? "Unsolo" : "Solo"}
        onClick={(e) => {
          e.stopPropagation();
          onSolo();
        }}
        className={`${btn} border-l border-line ${solo ? "bg-warn/25 text-warn" : "bg-card text-ink hover:text-strong"}`}
      >
        S
      </button>
    </div>
  );
}
