/**
 * The built-in sample kit: pure data (ids + human names), DOM-free so the Node
 * MCP server and tests can import it without Web Audio or Vite. The actual bytes
 * (and their bundled URLs) live in the browser-only `builtinUrls.ts`; this file
 * is the single list the UI, MCP, and the Sampler iterate.
 *
 * A sample is referenced by a tagged string ("the ref"): "builtin:<id>" for a
 * sample shipped with the app, "file:<fileId>" for an imported one (PR 2), or
 * "" for an empty slot. Keeping refs as opaque tagged strings lets a single
 * `sample` param kind serve both without the schema knowing the catalog.
 */

export interface BuiltinSample {
  /** Stable id, e.g. "kick". The ref is `builtin:${id}`. */
  id: string;
  /** Human-readable name for the picker and MCP. */
  name: string;
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

export type SampleRef = { kind: "none" } | { kind: "builtin"; id: string } | { kind: "file"; fileId: string };

/** Build the ref string for a built-in sample. */
export const builtinRef = (id: string): string => `builtin:${id}`;

/** Build the ref string for an imported sample (PR 2). */
export const fileRef = (fileId: string): string => `file:${fileId}`;

/** Parse a tagged sample ref. Unknown/empty refs parse to `{ kind: "none" }`. */
export function parseRef(ref: string): SampleRef {
  if (ref.startsWith("builtin:")) return { kind: "builtin", id: ref.slice("builtin:".length) };
  if (ref.startsWith("file:")) return { kind: "file", fileId: ref.slice("file:".length) };
  return { kind: "none" };
}

/** Human name for a ref, for labels (built-ins resolve via the catalog). */
export function refLabel(ref: string): string {
  const parsed = parseRef(ref);
  if (parsed.kind === "builtin") {
    return BUILTIN_SAMPLES.find((sample) => sample.id === parsed.id)?.name ?? parsed.id;
  }
  if (parsed.kind === "file") return parsed.fileId.slice(0, 8);
  return "None";
}
