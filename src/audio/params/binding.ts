/**
 * The generic parameter-binding seam, shared by instruments and effects. A
 * `ParamBinding` applies a parameter value to the audio graph; `bindParams`
 * connects a ParamStore to a set of bindings (apply current values, then keep
 * them in sync on change). This is the seam that keeps every ParamStore
 * transport-agnostic: a worklet-backed param would only change its binding, not
 * the store/UI/MCP above it.
 */
import type { ParamStore } from "./store";
import type { ParamValue } from "./types";

export interface ParamBinding {
  apply(value: ParamValue, smoothMs?: number): void;
}

/** Ramp a native AudioParam toward a value, smoothing if requested. */
export function rampParam(ctx: BaseAudioContext, param: AudioParam, value: number, smoothMs?: number): void {
  const now = ctx.currentTime;
  if (smoothMs && smoothMs > 0) {
    param.setTargetAtTime(value, now, smoothMs / 1000);
  } else {
    param.setValueAtTime(value, now);
  }
}

/**
 * Apply every binding from the store's current values, then subscribe so future
 * changes flow through. Returns an unsubscribe function. (A number param's
 * `smoothMs` is passed through so the binding can ramp instead of jump.)
 */
export function bindParams(store: ParamStore, bindings: Record<string, ParamBinding>): () => void {
  const apply = (id: string): void => {
    const binding = bindings[id];
    if (!binding) return;
    const spec = store.spec(id);
    const smoothMs = spec.kind === "number" ? spec.smoothMs : undefined;
    binding.apply(store.get(id), smoothMs);
  };
  for (const id of Object.keys(bindings)) apply(id);
  return store.subscribe((id) => apply(id));
}
