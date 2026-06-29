/**
 * Browser-only: the bundled bytes for the built-in kit and a decoder. The `?url`
 * suffix tells Vite to emit each WAV as a build asset and hand back its URL
 * (the same asset-bundling pattern the worklets use). Kept separate from the
 * DOM-free `catalog.ts` so the Node MCP server can import the catalog without
 * pulling in Vite asset imports or Web Audio.
 */
import { parseRef } from "./catalog";
import kickUrl from "./assets/kick.wav?url";
import snareUrl from "./assets/snare.wav?url";
import hatClosedUrl from "./assets/hat-closed.wav?url";
import hatOpenUrl from "./assets/hat-open.wav?url";
import clapUrl from "./assets/clap.wav?url";
import rimUrl from "./assets/rim.wav?url";
import tomUrl from "./assets/tom.wav?url";

/** Built-in sample id -> bundled asset URL. Keys match `BUILTIN_SAMPLES`. */
export const BUILTIN_URLS: Record<string, string> = {
  kick: kickUrl,
  snare: snareUrl,
  "hat-closed": hatClosedUrl,
  "hat-open": hatOpenUrl,
  clap: clapUrl,
  rim: rimUrl,
  tom: tomUrl,
};

// One decode per ref, shared across every Sampler instance (buffers are immutable).
const cache = new Map<string, Promise<AudioBuffer>>();

/**
 * Decode the audio for a sample ref into an AudioBuffer, or resolve null for an
 * empty/unknown ref. Built-in refs fetch their bundled URL; "file:" refs (imported
 * samples) arrive in a later slice and throw here for now.
 */
export function loadSampleBuffer(ctx: BaseAudioContext, ref: string): Promise<AudioBuffer | null> {
  const parsed = parseRef(ref);
  if (parsed.kind === "none") return Promise.resolve(null);
  if (parsed.kind === "file") {
    return Promise.reject(new Error(`Imported samples are not supported yet: ${ref}`));
  }
  const url = BUILTIN_URLS[parsed.id];
  if (!url) return Promise.resolve(null);

  let pending = cache.get(ref);
  if (!pending) {
    pending = fetch(url)
      .then((response) => response.arrayBuffer())
      .then((bytes) => ctx.decodeAudioData(bytes));
    cache.set(ref, pending);
  }
  return pending;
}
