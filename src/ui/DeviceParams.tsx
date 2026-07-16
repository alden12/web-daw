/**
 * The parameter panel inside a device card (a MIDI device or an audio effect): the
 * schema's knobs/selectors laid out in a row, with any boolean toggles collected into a
 * vertical column on the left so a device with several switches (e.g. the Octavator's
 * octave up/down) reads as a tidy checklist rather than a wide row. Schema-driven - it
 * maps over the specs and delegates each to the generic Knob, so it never branches on
 * param names, only on the boolean *kind* for layout.
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
  const toggles = schema.filter((spec) => spec.kind === "boolean");
  const rest = schema.filter((spec) => spec.kind !== "boolean");
  const knob = (spec: ParamSchema[number]) => (
    <Knob key={spec.id} spec={spec} store={store} onChange={onChange} author={authorOf(spec.id)} />
  );

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {toggles.length > 0 ? <div className="flex flex-col justify-center gap-2">{toggles.map(knob)}</div> : null}
      {rest.map(knob)}
    </div>
  );
}
