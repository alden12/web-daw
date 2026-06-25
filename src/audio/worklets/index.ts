/**
 * The single registry of AudioWorklet processor modules. The `?worker&url` suffix
 * tells Vite to bundle each `*.worklet.ts` as its own entry (transpiling TS and
 * inlining its imports, e.g. the shared `dsp/*` modules) and hand back a URL string
 * suitable for `audioWorklet.addModule`. `loadWorklets` adds them all once per context
 * (idempotent), so engine startup can await it before constructing any
 * AudioWorkletNode. Adding a new worklet processor = author the `*.worklet.ts` and add
 * one import here.
 */
import bitcrusherUrl from "./bitcrusher.worklet.ts?worker&url";
import captureUrl from "./capture.worklet.ts?worker&url";
import wavetableUrl from "../instruments/wavetable.worklet.ts?worker&url";

const MODULE_URLS: string[] = [bitcrusherUrl, captureUrl, wavetableUrl];

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Add every registered worklet module to `ctx` (once per context). */
export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  let pending = loaded.get(ctx);
  if (!pending) {
    pending = Promise.all(MODULE_URLS.map((url) => ctx.audioWorklet.addModule(url))).then(() => undefined);
    loaded.set(ctx, pending);
  }
  return pending;
}
