/**
 * Draws an audio clip's amplitude overview (min/max peaks) onto a canvas that fills
 * its parent, redrawing on resize (zoom, panel resize) via a ResizeObserver. Shared
 * by the arrangement clip block and the center audio-clip panel. While the peaks are
 * still decoding (or on failure) it renders nothing, so the caller's plain block shows
 * through. Purely presentational + pointer-transparent, so it never blocks clip drags.
 */
import { useEffect, useRef, useState } from "react";
import { loadPeaks, type Peaks } from "../audio/waveform";

/** Peaks for a file, loaded lazily; re-renders when ready. (loadPeaks resolves
 *  synchronously-fast for an already-cached file, so a cache hit paints next tick.) */
function useWaveform(fileId: string): Peaks | null {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPeaks(fileId).then((p) => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [fileId]);
  return peaks;
}

function draw(canvas: HTMLCanvasElement, peaks: Peaks, gain: number, color: string, clipColor: string): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h || !peaks.min.length) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const n = peaks.min.length;
  // One vertical bar per pixel column; the clip's peaks are stretched to fill the
  // width (a recorded take's placement is its natural length, so this is 1:1). Peaks
  // are scaled by the clip gain so the trace grows as you boost; any column that
  // would exceed full scale (clip) is drawn in the warning colour and capped.
  for (let x = 0; x < w; x++) {
    const bucket = Math.min(n - 1, Math.floor((x / w) * n));
    const hi = peaks.max[bucket] * gain;
    const lo = peaks.min[bucket] * gain;
    const clipped = hi > 1 || lo < -1;
    const top = mid - Math.min(1, hi) * mid;
    const bottom = mid - Math.max(-1, lo) * mid;
    ctx.fillStyle = clipped ? clipColor : color;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

export function Waveform({
  fileId,
  gain = 1,
  className = "",
  style,
}: {
  fileId: string;
  /** Scales the trace (clip gain); columns past full scale show clipping. */
  gain?: number;
  className?: string;
  /** Positioning (e.g. sliding the trace under the grid); width drives the canvas. */
  style?: React.CSSProperties;
}) {
  const peaks = useWaveform(fileId);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    // Resolve theme colours once (canvas needs concrete colours, not CSS vars).
    const root = getComputedStyle(document.documentElement);
    const color = root.getPropertyValue("--color-you").trim() || "#56c7c2";
    const clipColor = root.getPropertyValue("--color-claude").trim() || "#e0795f";
    const render = () => draw(canvas, peaks, gain, color, clipColor);
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, gain]);

  if (!peaks) return null;
  return <canvas ref={canvasRef} aria-hidden="true" style={style} className={`pointer-events-none ${className}`} />;
}
