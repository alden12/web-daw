/**
 * The selected track's instrument controls: the generic Knob mapped over the
 * instrument's schema. No per-instrument-type UI - adding an engine with its own
 * schema gets a panel for free.
 */
import type { ParamStore } from '../audio/params/store';
import { instrumentSchema } from '../audio/instruments/catalog';
import { Knob } from './Knob';

export function InstrumentPanel({
  params,
  instrumentType,
}: {
  params: ParamStore;
  instrumentType: string;
}) {
  const schema = instrumentSchema(instrumentType);
  return (
    <div className="rack">
      {schema.map((spec) => (
        <Knob key={spec.id} spec={spec} store={params} />
      ))}
    </div>
  );
}
