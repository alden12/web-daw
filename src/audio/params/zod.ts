/**
 * Build a zod schema from a ParamSpec. This is the single place a parameter's
 * declared shape becomes a runtime validator, so the MCP boundary (and any other
 * untrusted input) validates with zod rather than hand-rolled checks. Keyed by
 * kind via a map, so adding a spec kind is a typed, one-entry change.
 */
import { z } from "zod";
import type { ParamSpec } from "./types";

type ByKind<K extends ParamSpec["kind"]> = Extract<ParamSpec, { kind: K }>;

const SCHEMA: { [K in ParamSpec["kind"]]: (spec: ByKind<K>) => z.ZodType } = {
  number: (spec) => z.number().refine((v) => Number.isFinite(v) && v >= spec.min && v <= spec.max),
  enum: (spec) => z.enum(spec.options as [string, ...string[]]),
  boolean: () => z.boolean(),
};

export function specToZod(spec: ParamSpec): z.ZodType {
  return (SCHEMA[spec.kind] as (spec: ParamSpec) => z.ZodType)(spec);
}
