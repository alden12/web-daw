/**
 * The MIDI-device transform format: a device described as *data* - a param schema
 * plus a small note-event transform - rather than hand-written code, mirroring the
 * declarative instrument/effect graph (see graph/types.ts). A MIDI device processes
 * *note events* (not an audio signal), so this whole layer is DOM-free: the pure
 * transform here is interpreted by GraphMidiDevice at runtime, and the Node MCP
 * server can host the catalog directly.
 *
 * The one transform kind so far is a fan-out `tap`: for each incoming note, emit N
 * copies, each with a pitch offset, a velocity scale, and an optional time offset
 * (beats). A tap can be gated by a boolean param. This single primitive expresses an
 * octavator today and a MIDI delay / fixed harmonizer later; a scale-aware `map` kind
 * slots into the same union when a project key exists.
 */
import type { ParamSchema, ParamValue } from "../../params/types";
import type { NumberField, ParamRef } from "../../graph/types";

/** A boolean field: a fixed value, or bound to a (boolean) parameter. */
export type BooleanField = boolean | ParamRef;

/** One fan-out tap: a pitch-shifted, velocity-scaled, optionally time-shifted copy. */
export interface NoteTap {
  /** Pitch offset in semitones (literal or param-bound). */
  semitones: NumberField;
  /** Velocity multiplier for this copy. Default 1. */
  velocityScale?: NumberField;
  /** Time offset in beats (0 = same time; a MIDI delay uses >0). Default 0. */
  beats?: NumberField;
  /** Whether the tap emits. Default true; a disabled tap is skipped. */
  enabled?: BooleanField;
}

/** A note transform. Extensible union - `tap` (fan-out) is the only kind so far. */
export type MidiTransform = { kind: "tap"; taps: NoteTap[] };

/** A MIDI device as data: its schema (the keystone) + a note transform. */
export interface MidiDeviceDef {
  type: string;
  /** Human-facing name for the library/palette (defaults from the catalog entry). */
  label?: string;
  schema: ParamSchema;
  transform: MidiTransform;
}

/**
 * The per-event evaluation context. Holds the current param values today; a future
 * project key/scale slots in here so a scale-aware device is a pure add (no seam
 * change). See the plan's forward note.
 */
export interface TransformContext {
  readParam: (id: string) => ParamValue;
}

/** A concrete note the transform emits for one incoming note. */
export interface EmittedNote {
  midi: number;
  velocity: number;
  /** Time offset in beats relative to the incoming event (0 for the octavator). */
  beats: number;
}

const resolveNumber = (field: NumberField | undefined, fallback: number, ctx: TransformContext): number => {
  if (field === undefined) return fallback;
  if (typeof field === "number") return field;
  const raw = ctx.readParam(field.param) as number;
  return raw * (field.scale ?? 1) + (field.offset ?? 0);
};

const resolveBoolean = (field: BooleanField | undefined, fallback: boolean, ctx: TransformContext): boolean => {
  if (field === undefined) return fallback;
  if (typeof field === "boolean") return field;
  return Boolean(ctx.readParam(field.param));
};

/**
 * Run a transform over one incoming note, returning the concrete notes to emit.
 * Pure (no audio, no clock): the interpreter applies these to the downstream target
 * and schedules the `beats` offset. Notes shifted outside the MIDI range are dropped.
 */
export function applyTransform(
  transform: MidiTransform,
  midi: number,
  velocity: number,
  ctx: TransformContext,
): EmittedNote[] {
  return transform.taps
    .filter((tap) => resolveBoolean(tap.enabled, true, ctx))
    .map((tap) => ({
      midi: midi + Math.round(resolveNumber(tap.semitones, 0, ctx)),
      velocity: velocity * resolveNumber(tap.velocityScale, 1, ctx),
      beats: resolveNumber(tap.beats, 0, ctx),
    }))
    .filter((note) => note.midi >= 0 && note.midi <= 127);
}
