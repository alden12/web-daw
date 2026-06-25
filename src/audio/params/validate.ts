/**
 * Strict validation of a value against a ParamSpec, returning an error message
 * (or null if valid). Used by the MCP server to give the model clear feedback
 * instead of silently clamping (the store coerces; this rejects). Validation is
 * done by zod (see specToZod); the message is curated per kind for clarity.
 */
import type { ParamSpec, ParamValue } from "./types";
import { specToZod } from "./zod";

type ByKind<K extends ParamSpec["kind"]> = Extract<ParamSpec, { kind: K }>;

const MESSAGE: { [K in ParamSpec["kind"]]: (spec: ByKind<K>) => string } = {
  number: (spec) => `"${spec.id}" must be a number in ${spec.min}..${spec.max}${spec.unit ? ` ${spec.unit}` : ""}.`,
  enum: (spec) => `"${spec.id}" must be one of: ${spec.options.join(", ")}.`,
  boolean: (spec) => `"${spec.id}" expects a boolean.`,
};

export function validateParam(spec: ParamSpec, value: ParamValue): string | null {
  const valid = specToZod(spec).safeParse(value).success;
  return valid ? null : (MESSAGE[spec.kind] as (spec: ParamSpec) => string)(spec);
}
