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
  /** If set, values snap to this increment (e.g. 1 for whole semitones). */
  step?: number;
  /** If set, value changes are smoothed/ramped over this many milliseconds. */
  smoothMs?: number;
  /**
   * How the value is displayed/edited. Defaults to a plain number control.
   * "note" renders a note-name selector (C2, C#2, ...) matching the piano roll -
   * still just a MIDI-note number under the hood.
   */
  format?: "note";
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

/**
 * A reference to an audio asset (a sample). The value is a tagged string ref:
 * "builtin:<id>" for a sample shipped with the app, "file:<fileId>" for an
 * imported one, or "" for an empty slot. The choices are not fixed in the spec
 * (they come from the sample catalog / the project's imported samples), so the
 * same kind serves both the built-in kit and unbounded user imports.
 */
export interface SampleSpec extends BaseSpec {
  kind: "sample";
  default: string;
}

export type ParamSpec = NumberSpec | EnumSpec | BooleanSpec | SampleSpec;

export type ParamSchema = readonly ParamSpec[];

export type ParamValue = number | string | boolean;

/** A patch is the current value of every parameter, keyed by id. */
export type PatchValues = Record<string, ParamValue>;
