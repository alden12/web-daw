/**
 * The selected track's instrument as a device card in the signal-chain strip:
 * the generic Knob mapped over the instrument's schema. No per-instrument-type
 * UI - a new engine with its own schema gets a card for free.
 */
import type { ParamStore } from '../audio/params/store';
import { instrumentSchema, catalogEntry } from '../audio/instruments/catalog';
import { Knob } from './Knob';

export function InstrumentPanel({ params, instrumentType }: { params: ParamStore; instrumentType: string }) {
  const schema = instrumentSchema(instrumentType);
  return (
    <div className="shrink-0 border border-line rounded-xl bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-[12px] font-semibold text-bright">
        {catalogEntry(instrumentType).label}
        <span className="ml-auto font-mono text-[9px] tracking-wider uppercase text-faint">instr</span>
      </div>
      <div className="flex gap-3 px-3 py-3">
        {schema.map((spec) => (
          <Knob key={spec.id} spec={spec} store={params} />
        ))}
      </div>
    </div>
  );
}
