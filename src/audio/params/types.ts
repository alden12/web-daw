/**
 * The parameter model. This is the keystone of the whole project: every
 * parameter of every instrument/effect is described once, declaratively, and
 * the UI, MCP surface, automation, and patch save/load are all projections of
 * these descriptions. Nothing in here knows about audio.
 */

interface BaseSpec {
  /** Stable, unique key (e.g. "filter.cutoff"). Used by the store, UI, MCP, patches. */
  id: string;
  /** Human-readable label for UI controls and MCP tool descriptions. */
  label: string;
}

export interface NumberSpec extends BaseSpec {
  kind: "number";
  min: number;
  max: number;
  default: number;
  /** Display unit, e.g. "Hz", "dB", "ms", "cents". */
  unit?: string;
  /** How a UI control maps its position to a value. Defaults to "linear". */
  taper?: "linear" | "exponential";
  /** If set, value changes are smoothed/ramped over this many milliseconds. */
  smoothMs?: number;
}

export interface EnumSpec extends BaseSpec {
  kind: "enum";
  options: readonly string[];
  default: string;
}

export interface BooleanSpec extends BaseSpec {
  kind: "boolean";
  default: boolean;
}

export type ParamSpec = NumberSpec | EnumSpec | BooleanSpec;

export type ParamSchema = readonly ParamSpec[];

export type ParamValue = number | string | boolean;

/** A patch is the current value of every parameter, keyed by id. */
export type PatchValues = Record<string, ParamValue>;
