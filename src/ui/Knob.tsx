/**
 * A generic, schema-driven control. Given a ParamSpec it renders the right
 * control for the param's kind and reads/writes through the store. There is no
 * per-parameter UI code anywhere - panels are just this mapped over a schema.
 */
import { useRef } from 'react';
import type { ReactElement } from 'react';
import type { EnumSpec, NumberSpec, ParamSpec, ParamValue } from '../audio/params/types';
import type { ParamStore } from '../audio/params/store';
import { useParam } from '../audio/params/useParam';
import { fromNormalized, toNormalized } from '../audio/params/taper';

const DRAG_SENSITIVITY = 1 / 200; // normalized units per pixel dragged

/** Writes go through an injected callback so every edit becomes a logged command;
 *  reads stay live via useParam (the value updates after the command applies). */
type OnChange = (id: string, value: ParamValue) => void;

function formatValue(spec: NumberSpec, value: number): string {
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0;
  const text = value.toFixed(decimals);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

function NumberKnob({ spec, store, onChange }: { spec: NumberSpec; store: ParamStore; onChange: OnChange }) {
  const [value] = useParam(store, spec.id);
  const drag = useRef<{ startY: number; startNorm: number } | null>(null);
  const norm = toNormalized(spec, value as number);
  const angle = -135 + norm * 270;

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startNorm: norm };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const nextNorm = Math.min(1, Math.max(0, drag.current.startNorm - dy * DRAG_SENSITIVITY));
    onChange(spec.id, fromNormalized(spec, nextNorm));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  return (
    <div className="flex flex-col items-center gap-1.5 w-14">
      <div
        className="relative w-10 h-10 rounded-full bg-ground border border-line cursor-ns-resize touch-none focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-2"
        role="slider"
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value as number}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span
          className="absolute left-1/2 bottom-1/2 w-0.5 h-4 bg-you rounded-full origin-bottom"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-wide text-muted text-center leading-tight">{spec.label}</span>
      <span className="font-mono text-[10px] text-ink">{formatValue(spec, value as number)}</span>
    </div>
  );
}

export function Knob({ spec, store, onChange }: { spec: ParamSpec; store: ParamStore; onChange: OnChange }) {
  const [value] = useParam(store, spec.id);

  // One renderer per kind (map dispatch). useParam runs above unconditionally, so
  // hook order is stable regardless of which renderer is picked.
  const renderers: Record<ParamSpec['kind'], () => ReactElement> = {
    number: () => <NumberKnob spec={spec as NumberSpec} store={store} onChange={onChange} />,
    enum: () => (
      <label className="flex flex-col items-center gap-1.5 w-14">
        <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>
        <select
          value={value as string}
          onChange={(e) => onChange(spec.id, e.target.value)}
          className="font-mono text-[11px] bg-ground text-ink border border-line rounded-md px-1.5 py-1"
        >
          {(spec as EnumSpec).options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    ),
    boolean: () => (
      <label className="flex flex-col items-center gap-1.5 w-14">
        <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>
        <input type="checkbox" checked={value as boolean} onChange={(e) => onChange(spec.id, e.target.checked)} />
      </label>
    ),
  };

  return renderers[spec.kind]();
}
