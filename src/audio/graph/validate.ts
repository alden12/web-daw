/**
 * Pure validation for a declarative graph: every parameter it binds must exist in
 * the schema, and every connection endpoint must resolve to a known node or a
 * reserved endpoint. Runs in tests today (and could gate registration), catching a
 * mistyped param id or a dangling wire before it becomes a silent no-op at runtime.
 */
import type { ParamSchema } from "../params/types";
import type { Graph } from "./types";
import { isKnownKind, isAudioParam } from "./vocabulary";

/**
 * Every parameter id a graph references (for building bindings + validation). Pure - kept
 * here (not in the DOM-ful interpreter) so the validator + zod + the Node server can use it.
 */
export function collectParamIds(graph: Graph): string[] {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    const record = value as Record<string, unknown>;
    if (typeof record.param === "string") ids.add(record.param);
    for (const nested of Object.values(record)) walk(nested);
  };
  graph.nodes.forEach(walk);
  return [...ids];
}

/** Return a list of problems (empty = valid). `reserved` are the allowed non-node endpoints. */
export function validateGraph(schema: ParamSchema, graph: Graph, reserved: readonly string[]): string[] {
  const errors: string[] = [];
  const schemaIds = new Set(schema.map((spec) => spec.id));
  for (const id of collectParamIds(graph)) {
    if (!schemaIds.has(id)) errors.push(`binds unknown parameter "${id}"`);
  }
  // Node id -> kind, checking each kind is in the vocabulary.
  const kindById = new Map<string, string>();
  for (const node of graph.nodes) {
    kindById.set(node.id, node.kind);
    if (!isKnownKind(node.kind)) errors.push(`node "${node.id}" has unknown kind "${node.kind}"`);
  }
  const known = (id: string): boolean => kindById.has(id) || reserved.includes(id);
  for (const [from, to] of graph.connections) {
    if (!known(from)) errors.push(`connection from unknown node "${from}"`);
    const [toId, toParam] = to.split(".");
    if (!known(toId)) {
      errors.push(`connection to unknown node "${to}"`);
      continue;
    }
    // A `nodeId.param` target must name a real modulatable AudioParam of that kind.
    if (toParam !== undefined) {
      const kind = kindById.get(toId);
      if (!kind || !isKnownKind(kind) || !isAudioParam(kind, toParam)) {
        errors.push(`connection targets unknown parameter "${to}"`);
      }
    }
  }
  return errors;
}

/** Reserved endpoint ids for each device kind. */
export const INSTRUMENT_RESERVED = ["amp"] as const;
export const EFFECT_RESERVED = ["in", "wet"] as const;
