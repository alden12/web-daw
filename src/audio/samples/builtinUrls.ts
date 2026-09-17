/**
 * Browser-only: the bundled bytes for the built-in kit and a decoder. The `?url`
 * suffix tells Vite to emit each WAV as a build asset and hand back its URL
 * (the same asset-bundling pattern the worklets use). Kept separate from the
 * DOM-free `catalog.ts` so the Node MCP server can import the catalog without
 * pulling in Vite asset imports or Web Audio.
 */
import { parseRef } from "./catalog";
import { resolveSampleHash } from "./sampleRegistry";
import { getAudioBuffer } from "../audioStore";
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

// One decode per source, shared across every Sampler instance (buffers are
// immutable). Keyed by a "builtin:<id>" ref or by an asset's content hash, so two
// asset records over identical bytes share a single decode.
const cache = new Map<string, Promise<AudioBuffer>>();

function decodeOnce(key: string, bytes: () => Promise<ArrayBuffer>, ctx: BaseAudioContext): Promise<AudioBuffer> {
  let pending = cache.get(key);
  if (!pending) {
    pending = bytes().then((buffer) => ctx.decodeAudioData(buffer));
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Decode the audio for a sample ref into an AudioBuffer, or resolve null for an
 * empty/unresolvable ref. Built-in refs fetch their bundled URL; "asset:" refs
 * resolve to a content hash (via the sample registry) and read bytes from the
 * content-addressed store.
 */
export function loadSampleBuffer(ctx: BaseAudioContext, ref: string): Promise<AudioBuffer | null> {
  const parsed = parseRef(ref);
  if (parsed.kind === "builtin") {
    const url = BUILTIN_URLS[parsed.id];
    if (!url) return Promise.resolve(null);
    return decodeOnce(ref, () => fetch(url).then((response) => response.arrayBuffer()), ctx);
  }
  if (parsed.kind === "asset") {
    const hash = resolveSampleHash(parsed.id);
    if (!hash) return Promise.resolve(null);
    return decodeOnce(hash, () => getAudioBuffer(hash), ctx);
  }
  return Promise.resolve(null);
}
