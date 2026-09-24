/**
 * Runtime validation for declarative device definitions - the boundary gate for
 * untrusted input (a shared project file, or an MCP `create_*` call). zod schemas
 * mirror the TS types in types.ts (the specToZod convention), and `validateGraph`
 * adds the semantic checks zod can't express (param refs resolve, connections wire to
 * real nodes/params). DOM-free, so the Node MCP server validates with the same code.
 *
 * `parseCustomDevices` is lenient by design: it drops any invalid def with a warning
 * rather than throwing, so a corrupt or hostile project still opens (its bad devices
 * just don't load). `parseInstrumentDef` / `parseEffectDef` validate a single def and
 * return its errors, for the MCP tools to surface.
 */
import { z } from "zod";
import type { ParamSchema } from "../params/types";
import { ANALOG_WAVEFORMS, IMPULSE_SHAPES, NOISE_COLORS, SHAPER_SHAPES, WAVETABLE_BANKS } from "./types";
import type { Graph, GraphInstrumentDef, GraphEffectDef } from "./types";
import { validateGraph, INSTRUMENT_RESERVED, EFFECT_RESERVED } from "./validate";
import { tableProblem } from "./table";

/** Bump when the def shape changes incompatibly; older/newer versions are refused. */
export const DEVICE_FORMAT_VERSION = 1;

const paramRef = z.object({ param: z.string(), scale: z.number().optional(), offset: z.number().optional() }).strict();
const table = z.array(z.tuple([z.number(), z.number()])).superRefine((points, issues) => {
  const problem = tableProblem(points);
  if (problem) issues.addIssue({ code: "custom", message: problem });
});
// Only a number can be read off a table; an enum or a switch binds its param as it is.
const numberRef = z
  .object({ param: z.string(), table: table.optional(), scale: z.number().optional(), offset: z.number().optional() })
  .strict();
const numberField = z.union([z.number(), numberRef]);
const enumField = z.union([z.string(), paramRef]);
const boolField = z.union([z.boolean(), paramRef]);

const nodeSpec = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string(),
      kind: z.literal("osc"),
      waveform: enumField.optional(),
      frequency: numberField.optional(),
      noteRatio: numberField.optional(),
      detune: numberField.optional(),
    })
    .strict(),
  z.object({ id: z.string(), kind: z.literal("gain"), gain: numberField.optional() }).strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("biquad"),
      filterType: z.string().optional(),
      frequency: numberField.optional(),
      q: numberField.optional(),
      gain: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("delay"),
      maxSeconds: z.number().optional(),
      delayTime: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("shaper"),
      oversample: z.string().optional(),
      curve: z.object({ shape: z.enum(SHAPER_SHAPES), amount: numberField }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("env"),
      attack: numberField.optional(),
      decay: numberField.optional(),
      sustain: numberField.optional(),
      release: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("buffer"),
      sample: enumField,
      note: numberField.optional(),
      root: numberField.optional(),
      keytrack: boolField.optional(),
      detune: numberField.optional(),
      oneShot: boolField.optional(),
      start: numberField.optional(),
      trimEnd: numberField.optional(),
    })
    .strict(),
  z.object({ id: z.string(), kind: z.literal("noise"), color: z.enum(NOISE_COLORS).optional() }).strict(),
  z.object({ id: z.string(), kind: z.literal("constant"), offset: numberField.optional() }).strict(),
  z.object({ id: z.string(), kind: z.literal("pan"), pan: numberField.optional() }).strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("compressor"),
      threshold: numberField.optional(),
      knee: numberField.optional(),
      ratio: numberField.optional(),
      attack: numberField.optional(),
      release: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("convolver"),
      impulse: z.object({ shape: z.enum(IMPULSE_SHAPES), seconds: numberField }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("wavetableOsc"),
      bank: z.union([z.enum(WAVETABLE_BANKS), paramRef]).optional(),
      position: numberField.optional(),
      frequency: numberField.optional(),
      noteRatio: numberField.optional(),
      detune: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("analogOsc"),
      waveform: z.union([z.enum(ANALOG_WAVEFORMS), paramRef]).optional(),
      frequency: numberField.optional(),
      noteRatio: numberField.optional(),
      detune: numberField.optional(),
      pulseWidth: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("ladder"),
      frequency: numberField.optional(),
      resonance: numberField.optional(),
      detune: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("bitcrush"),
      bits: numberField.optional(),
      downsample: numberField.optional(),
    })
    .strict(),
]);

const graph = z.object({ nodes: z.array(nodeSpec), connections: z.array(z.tuple([z.string(), z.string()])) }).strict();

// A parameter *declaration* (the schema entry), distinct from specToZod which validates a value.
const baseSpec = { id: z.string(), label: z.string() };
const paramSpec = z.discriminatedUnion("kind", [
  z
    .object({
      ...baseSpec,
      kind: z.literal("number"),
      min: z.number(),
      max: z.number(),
      default: z.number(),
      unit: z.string().optional(),
      taper: z.enum(["linear", "exponential"]).optional(),
      step: z.number().optional(),
      smoothMs: z.number().optional(),
      format: z.literal("note").optional(),
    })
    .strict(),
  z.object({ ...baseSpec, kind: z.literal("enum"), options: z.array(z.string()), default: z.string() }).strict(),
  z.object({ ...baseSpec, kind: z.literal("boolean"), default: z.boolean() }).strict(),
  z.object({ ...baseSpec, kind: z.literal("sample"), default: z.string() }).strict(),
]);
const paramSchema = z.array(paramSpec);

export const instrumentDefSchema = z
  .object({ type: z.string(), label: z.string().optional(), schema: paramSchema, voice: graph })
  .strict();
export const effectDefSchema = z
  .object({ type: z.string(), label: z.string().optional(), schema: paramSchema, graph: graph })
  .strict();

/**
 * Tool-input shapes: an author supplies everything but the `type` id (the server mints that).
 * Used as MCP `inputSchema` so the tool self-documents the def format.
 */
export const instrumentDefInputSchema = z.object({ label: z.string().optional(), schema: paramSchema, voice: graph });
export const effectDefInputSchema = z.object({ label: z.string().optional(), schema: paramSchema, graph: graph });

export type DefResult<T> = { ok: true; def: T } | { ok: false; errors: string[] };

const zodErrors = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);

export function parseInstrumentDef(raw: unknown): DefResult<GraphInstrumentDef> {
  const parsed = instrumentDefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const semantic = validateGraph(parsed.data.schema as ParamSchema, parsed.data.voice as Graph, INSTRUMENT_RESERVED);
  if (semantic.length) return { ok: false, errors: semantic };
  return { ok: true, def: parsed.data as GraphInstrumentDef };
}

export function parseEffectDef(raw: unknown): DefResult<GraphEffectDef> {
  const parsed = effectDefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const semantic = validateGraph(parsed.data.schema as ParamSchema, parsed.data.graph as Graph, EFFECT_RESERVED);
  if (semantic.length) return { ok: false, errors: semantic };
  return { ok: true, def: parsed.data as GraphEffectDef };
}

/** The defs `parseCustomDevices` could not read, exactly as they were stored. */
export interface UnreadableDevices {
  instruments: unknown[];
  effects: unknown[];
}

/**
 * Validate a project's custom devices, dropping any that don't pass (with a warning).
 * Never throws: an unknown format version or a malformed def must not stop the project
 * from opening.
 *
 * What it drops comes back as `unreadable`, untouched, for the project to write back out. A def
 * this build cannot read may be one a newer build can - a block kind added since - and opening
 * the project here must not be what deletes it.
 */
export function parseCustomDevices(data: {
  customInstruments?: unknown;
  customEffects?: unknown;
  deviceFormatVersion?: number;
}): { instruments: GraphInstrumentDef[]; effects: GraphEffectDef[]; unreadable: UnreadableDevices } {
  const entries = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
  if (data.deviceFormatVersion !== undefined && data.deviceFormatVersion !== DEVICE_FORMAT_VERSION) {
    console.warn(`Ignoring custom devices: format version ${data.deviceFormatVersion} != ${DEVICE_FORMAT_VERSION}.`);
    return {
      instruments: [],
      effects: [],
      unreadable: { instruments: entries(data.customInstruments), effects: entries(data.customEffects) },
    };
  }
  const sort = <T>(raw: unknown, parse: (value: unknown) => DefResult<T>, label: string) => {
    const results = entries(raw).map((entry) => ({ entry, result: parse(entry) }));
    results.forEach(({ result }) => {
      if (!result.ok) console.warn(`Dropping invalid custom ${label}: ${result.errors.join("; ")}`);
    });
    return {
      kept: results.flatMap(({ result }) => (result.ok ? [result.def] : [])),
      dropped: results.filter(({ result }) => !result.ok).map(({ entry }) => entry),
    };
  };
  const instruments = sort(data.customInstruments, parseInstrumentDef, "instrument");
  const effects = sort(data.customEffects, parseEffectDef, "effect");
  return {
    instruments: instruments.kept,
    effects: effects.kept,
    unreadable: { instruments: instruments.dropped, effects: effects.dropped },
  };
}
