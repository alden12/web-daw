/**
 * The canonical project-document schema: one zod source of truth for the bundle
 * documents. The client derives its TS types from these via `z.infer` (re-exported
 * through project/types.ts, so the ~14 importers are unchanged), and the sync server
 * validates writes against the SAME schemas (`server/api` reads `validateBundleFile`
 * from here) - so the persisted shape, the client types, and the server's zero-trust
 * boundary cannot drift.
 *
 * Pure zod, DOM/Node-free (like graph/zod.ts and params/zod.ts), so the Node server
 * imports it under a DOM-less tsconfig. Reuses graph/zod's instrument/effect def
 * schemas for embedded custom devices rather than redefining them.
 *
 * Depth: project.json is deep-validated down the tree (tracks/groups/clips/placements/
 * effects/params). Parameter *value* maps validate as `Record<string, ParamValue>` and
 * the `EditCommand` union stays STRUCTURAL (`{type: string}`) - deep per-param and
 * per-command validation are deferred (see docs/DESIGN.md). Object schemas are non-strict
 * (unknown keys are ignored, not rejected) and the server stores the original JSON, so
 * validation is a gate, never a filter - evolving/extra fields never break a save.
 */
import { z } from "zod";
import { instrumentDefSchema, effectDefSchema } from "../graph/zod";
import type { GraphInstrumentDef, GraphEffectDef } from "../graph/types";

/* -------------------------------------------------------------------------- */
/* Leaves                                                                     */
/* -------------------------------------------------------------------------- */

/** Who authored a piece of durable state (mirrors commands `Author` + project `ClipAuthor`). */
export const authorSchema = z.enum(["you", "claude", "agent"]);

/** A single parameter value (the union a ParamStore holds). */
export const paramValueSchema = z.union([z.number(), z.string(), z.boolean()]);

/** A patch: parameter id -> value. */
export const patchValuesSchema = z.record(z.string(), paramValueSchema);

/** A MIDI note event (mirrors sequencer/types NoteEvent; pitch 0-127, velocity 0..1). */
export const noteEventSchema = z.object({
  id: z.string(),
  pitch: z.number(),
  start: z.number(),
  length: z.number(),
  velocity: z.number(),
});

/** A project-library sample asset (mirrors samples/catalog SampleAsset). */
export const sampleAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentHash: z.string(),
  source: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Chain + clips                                                              */
/* -------------------------------------------------------------------------- */

export const effectDataSchema = z.object({
  id: z.string(),
  type: z.string(),
  bypassed: z.boolean(),
  params: patchValuesSchema,
});

export const midiDeviceDataSchema = z.object({
  id: z.string(),
  type: z.string(),
  bypassed: z.boolean(),
  params: patchValuesSchema,
});

export const placementSchema = z.object({
  id: z.string(),
  clipId: z.string(),
  startBeat: z.number(),
  offset: z.number(),
  length: z.number(),
});

export const noteClipDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: authorSchema,
  notes: z.array(noteEventSchema),
  lengthBeats: z.number(),
});

export const audioClipDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: authorSchema,
  fileId: z.string(),
  gain: z.number(),
  durationSec: z.number(),
  loopStartSec: z.number().optional(),
  loopEndSec: z.number().optional(),
  gridOffsetSec: z.number().optional(),
});

/* -------------------------------------------------------------------------- */
/* Tracks + groups                                                            */
/* -------------------------------------------------------------------------- */

const baseTrackFields = {
  id: z.string(),
  name: z.string(),
  parentId: z.string(),
  muted: z.boolean(),
  solo: z.boolean(),
  volume: z.number(),
};

// The chain/arrangement fields are optional on the persisted shape (defaulted on load),
// even though `snapshotProject` always writes them - so older/partial snapshots still load.
export const instrumentTrackDataSchema = z.object({
  ...baseTrackFields,
  kind: z.literal("instrument"),
  instrumentType: z.string(),
  params: patchValuesSchema.optional(),
  effects: z.array(effectDataSchema).optional(),
  midiDevices: z.array(midiDeviceDataSchema).optional(),
  clips: z.array(noteClipDataSchema).optional(),
  placements: z.array(placementSchema).optional(),
  activeClipId: z.string().optional(),
  launchedClipId: z.string().nullable().optional(),
});

export const audioTrackDataSchema = z.object({
  ...baseTrackFields,
  kind: z.literal("audio"),
  effects: z.array(effectDataSchema).optional(),
  clips: z.array(audioClipDataSchema).optional(),
  placements: z.array(placementSchema).optional(),
  activeClipId: z.string().optional(),
  launchedClipId: z.string().nullable().optional(),
});

export const trackDataSchema = z.discriminatedUnion("kind", [instrumentTrackDataSchema, audioTrackDataSchema]);

export const groupDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  collapsed: z.boolean(),
  muted: z.boolean(),
  solo: z.boolean(),
  volume: z.number(),
  effects: z.array(effectDataSchema),
});

// Embedded user-authored devices reuse graph/zod's strict def schemas (validated at load via
// parseCustomDevices too). Cast so the inferred type stays the graph def type (the def schemas
// infer a looser string-typed shape; the strict semantic check lives in graph/validate).
const customInstrumentSchema = instrumentDefSchema as unknown as z.ZodType<GraphInstrumentDef>;
const customEffectSchema = effectDefSchema as unknown as z.ZodType<GraphEffectDef>;

/* -------------------------------------------------------------------------- */
/* Project root (project.json)                                                */
/* -------------------------------------------------------------------------- */

export const projectDataSchema = z.object({
  groups: z.array(groupDataSchema),
  tracks: z.array(trackDataSchema),
  tempoBpm: z.number(),
  lengthBeats: z.number(),
  loopStart: z.number().optional(),
  grooveId: z.string().optional(),
  grooveAmount: z.number().optional(),
  samples: z.array(sampleAssetSchema).optional(),
  customInstruments: z.array(customInstrumentSchema).optional(),
  customEffects: z.array(customEffectSchema).optional(),
  deviceFormatVersion: z.number().optional(),
  authorship: z.record(z.string(), authorSchema).optional(),
  selectedTrackId: z.string().nullable(),
});

/* -------------------------------------------------------------------------- */
/* Other bundle documents                                                     */
/* -------------------------------------------------------------------------- */

export const manifestSchema = z.object({
  formatVersion: z.number(),
  projectId: z.string(),
  projectSchema: z.number(),
});

export const metaSchema = z.object({
  name: z.string(),
  modifiedAt: z.string(),
});

export const refsSchema = z.object({
  head: z.string(),
  branches: z.record(z.string(), z.string().nullable()),
});

/** Edit commands stay STRUCTURAL: a ~50-variant wire-coupled union, only asserted to be an object
 *  with a string `type`. `catchall(unknown)` PRESERVES the rest of the payload (note data, patch
 *  values, ...) - unlike a plain object, which strips unknown keys, so a validated command kept only
 *  its `type`. The edit-log append relies on the parsed output, so preserving the payload is required
 *  for replay to reconstruct HEAD. */
export const editCommandSchema = z.object({ type: z.string() }).catchall(z.unknown());

export const editEntrySchema = z.object({
  seq: z.number(),
  command: editCommandSchema,
  author: authorSchema,
  time: z.number(),
  kind: z.enum(["edit", "undo", "redo"]).optional(),
  label: z.string().optional(),
});

export const feedNoteSchema = z.object({
  seq: z.number(),
  text: z.string(),
  author: authorSchema,
  time: z.number(),
});

export const logSchema = z.array(editEntrySchema);
export const notesSchema = z.array(feedNoteSchema);

export const commitSchema = z.object({
  id: z.string(),
  parent: z.string().nullable(),
  author: authorSchema,
  message: z.string(),
  time: z.number(),
  auto: z.boolean(),
  entryCount: z.number(),
  snapshot: projectDataSchema.optional(),
  entries: z.array(editEntrySchema),
  notes: z.array(feedNoteSchema).optional(),
  lastSeq: z.number(),
});

const packedStackSchema = z.object({
  base: projectDataSchema.nullable(),
  steps: z.array(z.object({ command: editCommandSchema, author: authorSchema })),
});

export const undoStateSchema = z.object({
  undo: packedStackSchema,
  redo: packedStackSchema,
});

/* -------------------------------------------------------------------------- */
/* Inferred document types (re-exported through project/types.ts)             */
/* -------------------------------------------------------------------------- */

export type ClipAuthor = z.infer<typeof authorSchema>;
export type EffectData = z.infer<typeof effectDataSchema>;
export type MidiDeviceData = z.infer<typeof midiDeviceDataSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type NoteClipData = z.infer<typeof noteClipDataSchema>;
export type AudioClipData = z.infer<typeof audioClipDataSchema>;
export type InstrumentTrackData = z.infer<typeof instrumentTrackDataSchema>;
export type AudioTrackData = z.infer<typeof audioTrackDataSchema>;
export type TrackData = z.infer<typeof trackDataSchema>;
export type GroupData = z.infer<typeof groupDataSchema>;
export type ProjectData = z.infer<typeof projectDataSchema>;

/* -------------------------------------------------------------------------- */
/* Path -> schema dispatch (the shared "what a valid bundle file is")         */
/* -------------------------------------------------------------------------- */

/** Exact-path schemas; commits are matched by prefix in `bundleSchemaForPath`. */
const byPath: Record<string, z.ZodType> = {
  "manifest.json": manifestSchema,
  "meta.json": metaSchema,
  "project.json": projectDataSchema,
  "log.json": logSchema,
  "notes.json": notesSchema,
  "undo.json": undoStateSchema,
  "history/refs.json": refsSchema,
};

/** The schema for a bundle path, or null for JSON paths we don't model (accepted as-is). */
export function bundleSchemaForPath(path: string): z.ZodType | null {
  if (byPath[path]) return byPath[path];
  if (path.startsWith("history/commits/") && path.endsWith(".json")) return commitSchema;
  return null;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a parsed JSON bundle file against its path's schema. Known paths are
 * shape-checked; unmodeled JSON paths pass (still valid JSON, never read by the app).
 * Returns a compact error string on failure.
 */
export function validateBundleFile(path: string, json: unknown): ValidationResult {
  const schema = bundleSchemaForPath(path);
  if (!schema) return { ok: true };
  const result = schema.safeParse(json);
  if (result.success) return { ok: true };
  const error = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  return { ok: false, error };
}
