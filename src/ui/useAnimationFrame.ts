/**
 * Run `tick` once per animation frame while mounted, restarting when `deps` change.
 * Several views drive a playhead (and live overlays) straight off the audio clock
 * via `requestAnimationFrame` rather than React state, to avoid a re-render per
 * frame; they all repeated the same start/cancel scaffolding. This hook owns that
 * loop - the caller's `tick` reads the clock and mutates refs/DOM directly.
 */
import { useEffect, type DependencyList } from "react";

export function useAnimationFrame(tick: () => void, deps: DependencyList): void {
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
