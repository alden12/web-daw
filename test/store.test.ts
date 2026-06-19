import { describe, expect, it } from 'vitest';
import { ParamStore } from '../src/audio/params/store';
import { fromNormalized, toNormalized } from '../src/audio/params/taper';
import type { NumberSpec, ParamSchema } from '../src/audio/params/types';

const schema: ParamSchema = [
  { id: 'num', label: 'Num', kind: 'number', min: 0, max: 10, default: 5 },
  { id: 'choice', label: 'Choice', kind: 'enum', options: ['a', 'b', 'c'], default: 'a' },
  { id: 'flag', label: 'Flag', kind: 'boolean', default: false },
];

describe('ParamStore', () => {
  it('initializes values from the schema defaults', () => {
    const store = new ParamStore(schema);
    expect(store.get('num')).toBe(5);
    expect(store.get('choice')).toBe('a');
    expect(store.get('flag')).toBe(false);
  });

  it('clamps numbers to range', () => {
    const store = new ParamStore(schema);
    store.set('num', 999);
    expect(store.get('num')).toBe(10);
    store.set('num', -50);
    expect(store.get('num')).toBe(0);
  });

  it('rejects invalid enum values by falling back to the default', () => {
    const store = new ParamStore(schema);
    store.set('choice', 'b');
    expect(store.get('choice')).toBe('b');
    store.set('choice', 'nonsense');
    expect(store.get('choice')).toBe('a');
  });

  it('notifies subscribers only on actual change', () => {
    const store = new ParamStore(schema);
    const changes: Array<[string, unknown]> = [];
    store.subscribe((id, value) => changes.push([id, value]));
    store.set('num', 7);
    store.set('num', 7); // no-op, value unchanged
    expect(changes).toEqual([['num', 7]]);
  });

  it('round-trips snapshot and load', () => {
    const a = new ParamStore(schema);
    a.set('num', 3);
    a.set('choice', 'c');
    a.set('flag', true);
    const patch = a.snapshot();

    const b = new ParamStore(schema);
    b.load(patch);
    expect(b.snapshot()).toEqual(patch);
  });

  it('throws on unknown ids', () => {
    const store = new ParamStore(schema);
    expect(() => store.get('missing')).toThrow();
    expect(() => store.set('missing', 1)).toThrow();
  });
});

describe('taper', () => {
  const linear: NumberSpec = { id: 'l', label: 'L', kind: 'number', min: 0, max: 100, default: 0, taper: 'linear' };
  const exp: NumberSpec = { id: 'e', label: 'E', kind: 'number', min: 20, max: 20000, default: 440, taper: 'exponential' };

  it('maps endpoints to 0 and 1 (linear and exponential)', () => {
    for (const spec of [linear, exp]) {
      expect(toNormalized(spec, spec.min)).toBeCloseTo(0);
      expect(toNormalized(spec, spec.max)).toBeCloseTo(1);
    }
  });

  it('linear midpoint is the arithmetic mean', () => {
    expect(fromNormalized(linear, 0.5)).toBeCloseTo(50);
  });

  it('exponential midpoint is the geometric mean', () => {
    // sqrt(20 * 20000) = 632.45...
    expect(fromNormalized(exp, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000));
  });

  it('round-trips value -> normalized -> value', () => {
    for (const spec of [linear, exp]) {
      for (const v of [spec.min, spec.default, spec.max, (spec.min + spec.max) / 2]) {
        expect(fromNormalized(spec, toNormalized(spec, v))).toBeCloseTo(v);
      }
    }
  });
});
