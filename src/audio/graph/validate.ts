/**
 * Pure validation for a declarative graph: every parameter it binds must exist in
 * the schema, and every connection endpoint must resolve to a known node or a
 * reserved endpoint. Runs in tests today (and could gate registration), catching a
 * mistyped param id or a dangling wire before it becomes a silent no-op at runtime.
 */
import type { ParamSchema } from "../params/types";
import type { Graph } from "./types";
import { collectParamIds } from "./build";

/** Return a list of problems (empty = valid). `reserved` are the allowed non-node endpoints. */
export function validateGraph(schema: ParamSchema, graph: Graph, reserved: readonly string[]): string[] {
  const errors: string[] = [];
  const schemaIds = new Set(schema.map((spec) => spec.id));
  for (const id of collectParamIds(graph)) {
    if (!schemaIds.has(id)) errors.push(`binds unknown parameter "${id}"`);
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const known = (id: string): boolean => nodeIds.has(id) || reserved.includes(id);
  for (const [from, to] of graph.connections) {
    if (!known(from)) errors.push(`connection from unknown node "${from}"`);
    const toId = to.split(".")[0];
    if (!known(toId)) errors.push(`connection to unknown node "${to}"`);
  }
  return errors;
}

/** Reserved endpoint ids for each device kind. */
export const INSTRUMENT_RESERVED = ["amp"] as const;
export const EFFECT_RESERVED = ["in", "wet"] as const;
