/**
 * Server-side shape validation for the JSON bundle files - the "don't trust the client"
 * boundary. Every JSON write is checked against a structural schema for its path before it
 * reaches the DB, so malformed or wrong-shaped data can't be persisted (defensive now, and
 * essential once the API is reachable by an untrusted client).
 *
 * Deliberately STRUCTURAL, not a deep mirror of the app's model: we assert the top-level
 * type and the always-present fields (with correct primitive types), and lean on zod's
 * default "strip unknown keys" so extra/evolving fields pass rather than break saves. Deep
 * per-parameter validation stays where the schema lives - the client/MCP boundary (zod at
 * the param layer). Pure zod, no DOM/Node, so it compiles under both tsconfigs.
 */
import { z } from "zod";

const manifest = z.object({
  formatVersion: z.number(),
  projectId: z.string(),
  projectSchema: z.number(),
});

const meta = z.object({
  name: z.string(),
  modifiedAt: z.string(),
});

const project = z.object({
  groups: z.array(z.unknown()),
  tracks: z.array(z.unknown()),
  tempoBpm: z.number(),
  lengthBeats: z.number(),
});

const logEntry = z.object({ seq: z.number(), time: z.number() });
const log = z.array(logEntry);
const notes = z.array(z.object({ seq: z.number(), time: z.number(), text: z.string() }));

// Session undo/redo state: least critical, so just assert it is an object.
const undo = z.object({});

const refs = z.object({
  head: z.string(),
  branches: z.record(z.string(), z.union([z.string(), z.null()])),
});

const commit = z.object({
  id: z.string(),
  parent: z.union([z.string(), z.null()]),
  entries: z.array(z.unknown()),
});

/** Exact-path schemas; commits are matched by prefix below. */
const byPath: Record<string, z.ZodType> = {
  "manifest.json": manifest,
  "meta.json": meta,
  "project.json": project,
  "log.json": log,
  "notes.json": notes,
  "undo.json": undo,
  "history/refs.json": refs,
};

/** The schema for a bundle path, or null for JSON paths we don't model (accepted as-is). */
function schemaForPath(path: string): z.ZodType | null {
  if (byPath[path]) return byPath[path];
  if (path.startsWith("history/commits/") && path.endsWith(".json")) return commit;
  return null;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a parsed JSON bundle file against its path's structural schema. Known paths are
 * shape-checked; unmodeled JSON paths pass (they are still valid JSON, and the app never
 * reads a path it didn't write). Returns a compact error string on failure.
 */
export function validateBundleFile(path: string, json: unknown): ValidationResult {
  const schema = schemaForPath(path);
  if (!schema) return { ok: true };
  const result = schema.safeParse(json);
  if (result.success) return { ok: true };
  const error = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  return { ok: false, error };
}
