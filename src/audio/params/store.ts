/**
 * The single source of truth for a set of parameter values. Framework-agnostic
 * and audio-agnostic: the UI, the audio engine's bindings, MCP, and persistence
 * all read and write through this one object. It validates every write against
 * the schema and notifies subscribers.
 */
import type { ParamSchema, ParamSpec, ParamValue, PatchValues } from "./types";

type Listener = (id: string, value: ParamValue) => void;
type ByKind<K extends ParamSpec["kind"]> = Extract<ParamSpec, { kind: K }>;

// Lenient normalization (clamp/snap a trusted value), keyed by kind. Distinct
// from validation (validate.ts), which rejects. Map dispatch, not switch.
const COERCE: { [K in ParamSpec["kind"]]: (spec: ByKind<K>, value: ParamValue) => ParamValue } = {
  number: (spec, value) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.default;
  },
  enum: (spec, value) => (spec.options.includes(value as string) ? (value as string) : spec.default),
  boolean: (_spec, value) => Boolean(value),
  // A sample ref is an opaque tagged string; trust a string, fall back otherwise.
  sample: (spec, value) => (typeof value === "string" ? value : spec.default),
};

function coerce(spec: ParamSpec, value: ParamValue): ParamValue {
  return (COERCE[spec.kind] as (spec: ParamSpec, value: ParamValue) => ParamValue)(spec, value);
}

export class ParamStore {
  private readonly specs = new Map<string, ParamSpec>();
  private readonly values = new Map<string, ParamValue>();
  private readonly listeners = new Set<Listener>();

  constructor(schema: ParamSchema) {
    for (const spec of schema) {
      this.specs.set(spec.id, spec);
      this.values.set(spec.id, spec.default);
    }
  }

  spec(id: string): ParamSpec {
    const spec = this.specs.get(id);
    if (!spec) throw new Error(`Unknown parameter: ${id}`);
    return spec;
  }

  /** Every param spec, in schema order (for generic, schema-driven binding). */
  allSpecs(): ParamSpec[] {
    return [...this.specs.values()];
  }

  get(id: string): ParamValue {
    if (!this.specs.has(id)) throw new Error(`Unknown parameter: ${id}`);
    return this.values.get(id)!;
  }

  /** Set a value, coerced/validated against the schema. Notifies subscribers. */
  set(id: string, value: ParamValue): void {
    const spec = this.spec(id);
    const next = coerce(spec, value);
    if (this.values.get(id) === next) return;
    this.values.set(id, next);
    for (const listener of this.listeners) listener(id, next);
  }

  /** Subscribe to every value change. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Current value of every parameter, i.e. the patch. */
  snapshot(): PatchValues {
    return Object.fromEntries(this.values);
  }

  /** Apply a patch, validating each value. Ignores unknown ids. */
  load(patch: PatchValues): void {
    for (const [id, value] of Object.entries(patch)) {
      if (this.specs.has(id)) this.set(id, value);
    }
  }
}
