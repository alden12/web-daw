import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { INSTRUMENT_CATALOG } from '../src/audio/instruments/catalog';

describe('ProjectStore', () => {
  it('seeds one subtractive track by default and selects it', () => {
    const p = new ProjectStore();
    const s = p.getStructure();
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].instrumentType).toBe('subtractive');
    expect(s.selectedTrackId).toBe(s.tracks[0].id);
  });

  it('can start empty (server mirror) with seedDefault=false', () => {
    expect(new ProjectStore(false).getStructure().tracks).toHaveLength(0);
  });

  it('adds tracks of different instrument types, each with its own schema', () => {
    const p = new ProjectStore(false);
    const sub = p.addTrack('subtractive');
    const fm = p.addTrack('fm');
    expect(sub.params.spec('filter.cutoff')).toBeTruthy();
    expect(fm.params.spec('fm.ratio')).toBeTruthy();
    // FM has no filter param
    expect(() => fm.params.spec('filter.cutoff')).toThrow();
    expect(p.getStructure().tracks).toHaveLength(2);
  });

  it('honors an explicit id and is idempotent on re-add (sync from the other end)', () => {
    const p = new ProjectStore(false);
    const a = p.addTrack('fm', 'Bass', 't-abc');
    const b = p.addTrack('fm', 'Bass', 't-abc');
    expect(a).toBe(b);
    expect(p.getStructure().tracks).toHaveLength(1);
  });

  it('falls back to the default instrument for unknown types', () => {
    const t = new ProjectStore(false).addTrack('nope');
    expect(t.instrumentType).toBe('subtractive');
  });

  it('removes tracks and reselects', () => {
    const p = new ProjectStore(false);
    const a = p.addTrack('subtractive');
    const b = p.addTrack('fm');
    expect(p.selectedId).toBe(b.id);
    p.removeTrack(b.id);
    expect(p.selectedId).toBe(a.id);
    p.removeTrack(a.id);
    expect(p.selectedId).toBeNull();
  });

  it('sets mute, volume (clamped), and tempo (clamped)', () => {
    const p = new ProjectStore(false);
    const t = p.addTrack('subtractive');
    p.setMuted(t.id, true);
    expect(p.getTrack(t.id)!.muted).toBe(true);
    p.setVolume(t.id, 5);
    expect(p.getTrack(t.id)!.volume).toBe(1);
    p.setTempo(9999);
    expect(p.tempo).toBe(300);
  });

  it('round-trips snapshot and load (multiple tracks, params, clips)', () => {
    const a = new ProjectStore(false);
    const t1 = a.addTrack('subtractive', 'Lead');
    t1.params.set('filter.cutoff', 1234);
    t1.clip.addNote({ pitch: 60, start: 0 });
    const t2 = a.addTrack('fm', 'Bass');
    t2.params.set('fm.ratio', 3);
    a.setTempo(100);
    const snap = a.snapshot();

    const b = new ProjectStore(false);
    b.load(snap);
    expect(b.getStructure().tracks.map((t) => t.name)).toEqual(['Lead', 'Bass']);
    expect(b.tempo).toBe(100);
    const lead = b.getTrack(t1.id)!;
    expect(lead.params.get('filter.cutoff')).toBe(1234);
    expect(lead.clip.getClip().notes).toHaveLength(1);
    expect(b.getTrack(t2.id)!.params.get('fm.ratio')).toBe(3);
  });

  it('adds, reorders, bypasses, and removes effects, each with its own schema', () => {
    const p = new ProjectStore(false);
    const t = p.addTrack('subtractive');
    const delay = p.addEffect(t.id, 'delay')!;
    const reverb = p.addEffect(t.id, 'reverb')!;
    expect(p.getStructure().tracks[0].effects.map((fx) => fx.type)).toEqual(['delay', 'reverb']);
    // each effect has its own ParamStore over the effect's schema
    expect(delay.params.spec('delay.feedback')).toBeTruthy();
    expect(reverb.params.spec('reverb.decay')).toBeTruthy();
    expect(() => delay.params.spec('reverb.decay')).toThrow();

    // reorder: move reverb to the front
    p.moveEffect(t.id, reverb.id, 0);
    expect(p.getStructure().tracks[0].effects.map((fx) => fx.id)).toEqual([reverb.id, delay.id]);

    // bypass
    p.setEffectBypass(t.id, delay.id, true);
    expect(p.getEffect(t.id, delay.id)!.bypassed).toBe(true);

    // remove
    p.removeEffect(t.id, reverb.id);
    expect(p.getStructure().tracks[0].effects.map((fx) => fx.id)).toEqual([delay.id]);
  });

  it('falls back to the default effect for unknown types and is idempotent on re-add', () => {
    const p = new ProjectStore(false);
    const t = p.addTrack('subtractive');
    const fx = p.addEffect(t.id, 'nope')!;
    expect(fx.type).toBe('delay');
    const again = p.addEffect(t.id, 'delay', fx.id);
    expect(again).toBe(fx);
    expect(p.getTrack(t.id)!.effects).toHaveLength(1);
  });

  it('round-trips effects (type, bypass, params) through snapshot/load', () => {
    const a = new ProjectStore(false);
    const t = a.addTrack('subtractive', 'Pad');
    const rev = a.addEffect(t.id, 'reverb')!;
    rev.params.set('mix', 0.6);
    a.addEffect(t.id, 'delay');
    a.setEffectBypass(t.id, rev.id, true);
    const snap = a.snapshot();

    const b = new ProjectStore(false);
    b.load(snap);
    const effects = b.getTrack(t.id)!.effects;
    expect(effects.map((fx) => fx.type)).toEqual(['reverb', 'delay']);
    expect(effects[0].bypassed).toBe(true);
    expect(effects[0].params.get('mix')).toBe(0.6);
  });
});

describe('instrument catalog', () => {
  it('exposes a label and a valid schema for every instrument type', () => {
    for (const [type, def] of Object.entries(INSTRUMENT_CATALOG)) {
      expect(def.label).toBeTruthy();
      expect(def.schema.length).toBeGreaterThan(0);
      for (const spec of def.schema) {
        expect(spec.id).toBeTruthy();
        if (spec.kind === 'number') expect(spec.min).toBeLessThanOrEqual(spec.max);
      }
      expect(type).toBeTruthy();
    }
  });
});
