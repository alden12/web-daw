/**
 * The built-in sample kit: pure data (ids + human names), DOM-free so the Node
 * MCP server and tests can import it without Web Audio or Vite. The actual bytes
 * (and their bundled URLs) live in the browser-only `builtinUrls.ts`; this file
 * is the single list the UI, MCP, and the Sampler iterate.
 *
 * A sample is referenced by a tagged string ("the ref"): "builtin:<id>" for a
 * sample shipped with the app, "asset:<id>" for one in the project's sample
 * library (imported), or "" for an empty slot. Keeping refs as opaque tagged
 * strings lets a single `sample` param kind serve both without the schema
 * knowing the catalog.
 *
 * An imported sample is an *asset record* (see SampleAsset): a stable id that
 * survives edits/re-encodes, carrying the human name and pointing at the current
 * content hash (the bytes in the OPFS blob store). References use the stable id,
 * never the content hash, so trimming or re-encoding a sample never breaks them.
 */

export interface BuiltinSample {
  /** Stable id, e.g. "kick". The ref is `builtin:${id}`. */
  id: string;
  /** Human-readable name for the picker and MCP. */
  name: string;
}

/**
 * A project-library sample. `id` is stable (minted once at import); `contentHash`
 * is the current bytes (the OPFS blob key) and may change if the sample is later
 * edited. `source` records provenance ("import" now; a remote origin later).
 */
export interface SampleAsset {
  id: string;
  name: string;
  contentHash: string;
  source?: string;
}

export const BUILTIN_SAMPLES: BuiltinSample[] = [
  { id: "kick", name: "Kick" },
  { id: "snare", name: "Snare" },
  { id: "hat-closed", name: "Closed Hat" },
  { id: "hat-open", name: "Open Hat" },
  { id: "clap", name: "Clap" },
  { id: "rim", name: "Rim" },
  { id: "tom", name: "Tom" },
];

export type SampleRef = { kind: "none" } | { kind: "builtin"; id: string } | { kind: "asset"; id: string };

/** Build the ref string for a built-in sample. */
export const builtinRef = (id: string): string => `builtin:${id}`;

/** Build the ref string for a project-library (imported) sample. */
export const assetRef = (id: string): string => `asset:${id}`;

/** Parse a tagged sample ref. Unknown/empty refs parse to `{ kind: "none" }`. */
export function parseRef(ref: string): SampleRef {
  if (ref.startsWith("builtin:")) return { kind: "builtin", id: ref.slice("builtin:".length) };
  if (ref.startsWith("asset:")) return { kind: "asset", id: ref.slice("asset:".length) };
  return { kind: "none" };
}

/**
 * Human name for a ref, for labels. Built-ins resolve via the catalog; project
 * assets resolve via the passed library (the catalog is DOM-free and project-
 * agnostic, so the asset list is supplied by the caller).
 */
export function refLabel(ref: string, assets: SampleAsset[] = []): string {
  const parsed = parseRef(ref);
  if (parsed.kind === "builtin") {
    return BUILTIN_SAMPLES.find((sample) => sample.id === parsed.id)?.name ?? parsed.id;
  }
  if (parsed.kind === "asset") {
    return assets.find((asset) => asset.id === parsed.id)?.name ?? parsed.id;
  }
  return "None";
}
