/**
 * The parameter panel inside a device card (a MIDI device or an audio effect): the
 * schema's knobs laid out in a row, with the discrete controls (boolean toggles + enum
 * selects) collected into a vertical column on the left so a device with several switches
 * or dropdowns (the Octavator's octave up/down, the Arpeggiator's rate/pattern) reads as a
 * tidy stacked list rather than a wide row. Schema-driven - it maps over the specs and
 * delegates each to the generic Knob, branching only on *kind* for layout, never on names.
 */
import type { ParamSchema } from "../audio/params/types";
import type { ParamStore } from "../audio/params/store";
import type { ParamValue } from "../audio/params/types";
import { Knob } from "./Knob";

export function DeviceParams({
  schema,
  store,
  onChange,
  authorOf,
}: {
  schema: ParamSchema;
  store: ParamStore;
  onChange: (id: string, value: ParamValue) => void;
  authorOf: (paramId: string) => string | undefined;
}) {
  const stacked = schema.filter((spec) => spec.kind === "boolean" || spec.kind === "enum");
  const knobs = schema.filter((spec) => spec.kind !== "boolean" && spec.kind !== "enum");
  const knob = (spec: ParamSchema[number]) => (
    <Knob key={spec.id} spec={spec} store={store} onChange={onChange} author={authorOf(spec.id)} />
  );

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {stacked.length > 0 ? <div className="flex flex-col justify-center gap-2">{stacked.map(knob)}</div> : null}
      {knobs.map(knob)}
    </div>
  );
}
