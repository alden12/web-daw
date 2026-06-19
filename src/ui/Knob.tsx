/**
 * A generic, schema-driven control. Given a ParamSpec it renders the right
 * control for the param's kind and reads/writes through the store. There is no
 * per-parameter UI code anywhere - the synth panel is just this mapped over the
 * schema.
 */
import { useRef } from 'react';
import type { NumberSpec, ParamSpec } from '../audio/params/types';
import type { ParamStore } from '../audio/params/store';
import { useParam } from '../audio/params/useParam';
import { fromNormalized, toNormalized } from '../audio/params/taper';

const DRAG_SENSITIVITY = 1 / 200; // normalized units per pixel dragged

function formatValue(spec: NumberSpec, value: number): string {
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0;
  const text = value.toFixed(decimals);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

function NumberKnob({ spec, store }: { spec: NumberSpec; store: ParamStore }) {
  const [value, setValue] = useParam(store, spec.id);
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
    setValue(fromNormalized(spec, nextNorm));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  return (
    <div className="knob">
      <div
        className="knob-dial"
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
          className="knob-indicator"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      </div>
      <span className="knob-label">{spec.label}</span>
      <span className="knob-value">{formatValue(spec, value as number)}</span>
    </div>
  );
}

export function Knob({ spec, store }: { spec: ParamSpec; store: ParamStore }) {
  const [value, setValue] = useParam(store, spec.id);

  switch (spec.kind) {
    case 'number':
      return <NumberKnob spec={spec} store={store} />;
    case 'enum':
      return (
        <label className="control">
          <span className="knob-label">{spec.label}</span>
          <select value={value as string} onChange={(e) => setValue(e.target.value)}>
            {spec.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );
    case 'boolean':
      return (
        <label className="control">
          <span className="knob-label">{spec.label}</span>
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => setValue(e.target.checked)}
          />
        </label>
      );
  }
}
