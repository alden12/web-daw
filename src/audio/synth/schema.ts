/**
 * The parameter schema for the slice-1 subtractive mono synth. This is the only
 * place the synth's controllable surface is declared; the UI, the audio
 * bindings, and (later) MCP and patches are all derived from it.
 */
import type { ParamSchema } from '../params/types';

export const WAVEFORMS = ['sine', 'sawtooth', 'square', 'triangle'] as const;
export type Waveform = (typeof WAVEFORMS)[number];

export const synthSchema: ParamSchema = [
  {
    id: 'osc.waveform',
    label: 'Waveform',
    kind: 'enum',
    options: WAVEFORMS,
    default: 'sawtooth',
  },
  {
    id: 'osc.detune',
    label: 'Detune',
    kind: 'number',
    min: -100,
    max: 100,
    default: 0,
    unit: 'cents',
    taper: 'linear',
    smoothMs: 20,
  },
  {
    id: 'filter.cutoff',
    label: 'Cutoff',
    kind: 'number',
    min: 20,
    max: 20000,
    default: 4000,
    unit: 'Hz',
    taper: 'exponential',
    smoothMs: 15,
  },
  {
    id: 'filter.resonance',
    label: 'Resonance',
    kind: 'number',
    min: 0.0001,
    max: 24,
    default: 1,
    unit: 'Q',
    taper: 'linear',
    smoothMs: 15,
  },
  {
    id: 'amp.level',
    label: 'Level',
    kind: 'number',
    min: 0,
    max: 1,
    default: 0.8,
    taper: 'linear',
    smoothMs: 10,
  },
  {
    id: 'env.attack',
    label: 'Attack',
    kind: 'number',
    min: 1,
    max: 2000,
    default: 5,
    unit: 'ms',
    taper: 'exponential',
  },
  {
    id: 'env.release',
    label: 'Release',
    kind: 'number',
    min: 1,
    max: 4000,
    default: 200,
    unit: 'ms',
    taper: 'exponential',
  },
] as const;
