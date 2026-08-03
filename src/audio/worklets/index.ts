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
import nimbusUrl from "../instruments/nimbus.worklet.ts?worker&url";

const MODULE_URLS: string[] = [bitcrusherUrl, captureUrl, wavetableUrl, nimbusUrl];

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Why the engine refuses to start over plain http. `BaseAudioContext.audioWorklet` is
 * secure-context-only, so from a LAN address it is simply `undefined` - which is exactly
 * how the touch shell gets tested on a real phone. Left unchecked that surfaces as
 * "cannot read addModule of undefined", buried in a rejected promise, with the Start
 * button appearing to do nothing at all. `yarn dev:mobile` is the fix; this is the sign.
 */
export const INSECURE_CONTEXT_MESSAGE =
  "Audio needs a secure context. This page is served over plain http from a non-localhost address, so the browser has disabled AudioWorklet. Serve the app over https and reload.";

/** Add every registered worklet module to `ctx` (once per context). */
export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  // Not cached: nothing was loaded, and a later attempt from a secure context should try.
  if (!ctx.audioWorklet) return Promise.reject(new Error(INSECURE_CONTEXT_MESSAGE));
  let pending = loaded.get(ctx);
  if (!pending) {
    pending = Promise.all(MODULE_URLS.map((url) => ctx.audioWorklet.addModule(url))).then(() => undefined);
    loaded.set(ctx, pending);
  }
  return pending;
}
